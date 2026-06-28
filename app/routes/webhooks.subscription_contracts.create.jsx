import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  console.log(`Received subscription_contracts/create for ${shop}`);

  try {
    const contract = payload; // The Subscription Contract payload
    const contractId = contract.admin_graphql_api_id;
    
    // We need to fetch the line items of the contract, since the webhook payload might not have everything,
    // or it might just be the REST payload. To be safe, we query the GraphQL API.
    const response = await admin.graphql(`
      query getContract($id: ID!) {
        subscriptionContract(id: $id) {
          id
          lines(first: 10) {
            edges {
              node {
                id
                productId
                variantId
                sku
                quantity
              }
            }
          }
        }
      }
    `, { variables: { id: contractId } });
    
    const { data } = await response.json();
    const lines = data?.subscriptionContract?.lines?.edges || [];
    
    // Check if the contract has one of our placeholder SKUs
    for (const lineEdge of lines) {
      const line = lineEdge.node;
      if (line.sku && line.sku.startsWith("ANE-PC")) {
        const placeholderSku = line.sku;
        
        // Find the mapping in the database
        const mapping = await prisma.skuMapping.findUnique({
          where: { placeholderSku }
        });
        
        if (mapping && mapping.shippableSkus) {
          const shippableSkus = JSON.parse(mapping.shippableSkus);
          
          if (shippableSkus.length > 0) {
            console.log(`Swapping ${placeholderSku} for ${shippableSkus.join(", ")}`);
            
            // 1. Create a Subscription Draft
            const draftRes = await admin.graphql(`
              mutation subscriptionContractUpdate($contractId: ID!) {
                subscriptionContractUpdate(contractId: $contractId) {
                  draft {
                    id
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `, { variables: { contractId } });
            
            const draftData = await draftRes.json();
            const draftId = draftData?.data?.subscriptionContractUpdate?.draft?.id;
            
            if (!draftId) throw new Error("Could not create subscription draft");
            
            // 2. Remove the placeholder line item
            await admin.graphql(`
              mutation subscriptionDraftLineRemove($draftId: ID!, $lineId: ID!) {
                subscriptionDraftLineRemove(draftId: $draftId, lineId: $lineId) {
                  userErrors {
                    field
                    message
                  }
                }
              }
            `, { variables: { draftId, lineId: line.id } });
            
            // 3. Look up the variant IDs for the shippable SKUs so we can add them to the draft
            // For simplicity in this demo, we'll assume we find the first variant matching the SKU
            for (const sSku of shippableSkus) {
              const productRes = await admin.graphql(`
                query getVariantBySku($query: String!) {
                  productVariants(first: 1, query: $query) {
                    edges {
                      node {
                        id
                      }
                    }
                  }
                }
              `, { variables: { query: `sku:${sSku}` } });
              
              const pData = await productRes.json();
              const variantEdge = pData?.data?.productVariants?.edges?.[0];
              
              if (variantEdge) {
                const variantId = variantEdge.node.id;
                
                // Add the shippable variant line item
                await admin.graphql(`
                  mutation subscriptionDraftLineAdd($draftId: ID!, $input: SubscriptionLineInput!) {
                    subscriptionDraftLineAdd(draftId: $draftId, input: $input) {
                      userErrors {
                        field
                        message
                      }
                    }
                  }
                `, { 
                  variables: { 
                    draftId, 
                    input: { variantId, quantity: line.quantity } 
                  } 
                });
              }
            }
            
            // 4. Commit the draft to finalize the changes
            await admin.graphql(`
              mutation subscriptionDraftCommit($draftId: ID!) {
                subscriptionDraftCommit(draftId: $draftId) {
                  contract {
                    id
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `, { variables: { draftId } });
            
            // Log success
            await prisma.subscriptionLog.create({
              data: {
                shop,
                subscriptionContractId: contractId,
                placeholderSku,
                status: "SWAPPED"
              }
            });
            
            break; // We handled the placeholder line, we can stop checking lines
          }
        }
      }
    }
  } catch (error) {
    console.error("Error processing subscription contract", error);
    // Log failure (assuming contractId and placeholderSku are somewhat known)
    await prisma.subscriptionLog.create({
      data: {
        shop,
        subscriptionContractId: payload?.admin_graphql_api_id || "UNKNOWN",
        placeholderSku: "UNKNOWN",
        status: "FAILED",
        error: error.message
      }
    });
  }

  return new Response();
};
