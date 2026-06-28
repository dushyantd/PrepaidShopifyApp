import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useActionData } from "react-router";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  Link,
  InlineStack,
  TextField,
  Divider,
  DataTable,
  Badge,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const mappings = await prisma.skuMapping.findMany({
    where: { shop },
  });

  const response = await admin.graphql(
    `#graphql
    query getContracts {
      subscriptionContracts(first: 50) {
        edges {
          node {
            id
            status
            createdAt
            nextBillingDate
            customer {
              id
              firstName
              lastName
            }
            orders(first: 6) {
              edges {
                node {
                  id
                  createdAt
                }
              }
            }
          }
        }
      }
    }`
  );
  const { data } = await response.json();
  const contracts = data?.subscriptionContracts?.edges?.map(e => e.node) || [];

  return { mappings, contracts };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "saveMapping") {
    const placeholderSku = formData.get("placeholderSku");
    const shippableSkus = formData.get("shippableSkus"); // Comma-separated or JSON
    
    // Parse comma-separated into JSON array
    const skusArray = shippableSkus.split(',').map(s => s.trim()).filter(Boolean);

    await prisma.skuMapping.upsert({
      where: { placeholderSku },
      update: { shippableSkus: JSON.stringify(skusArray) },
      create: { shop, placeholderSku, shippableSkus: JSON.stringify(skusArray) },
    });
    return { success: true };
  }

  if (actionType === "createSellingPlans") {
    // Create the 6-month prepaid selling plan
    const response = await admin.graphql(
      `#graphql
      mutation {
        sellingPlanGroupCreate(
          input: {
            name: "Friends of Ane Prepaid"
            merchantCode: "friends-of-ane-prepaid"
            options: ["Delivery frequency"]
            position: 1
            sellingPlansToCreate: [
              {
                name: "6-Month Prepaid, Monthly Delivery"
                options: "6 Months"
                category: SUBSCRIPTION
                billingPolicy: {
                  recurring: {
                    interval: MONTH
                    intervalCount: 6
                    maxCycles: 1
                  }
                }
                deliveryPolicy: {
                  recurring: {
                    interval: MONTH
                    intervalCount: 1
                    anchors: [{
                      type: MONTHDAY
                      day: 5
                      cutoffDay: 15
                    }]
                    preAnchorBehavior: NEXT
                  }
                }
              }
            ]
          }
          resources: { productIds: [] } 
        ) {
          sellingPlanGroup {
            id
            name
          }
          userErrors {
            field
            message
          }
        }
      }`
    );
    const data = await response.json();
    return { data };
  }

  if (actionType === "pauseSubscription") {
    const contractId = formData.get("contractId");
    const response = await admin.graphql(
      `#graphql
      mutation PauseSubscription($id: ID!) {
        subscriptionContractPause(subscriptionContractId: $id) {
          contract {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { id: contractId } }
    );
    const data = await response.json();
    return { data };
  }

  if (actionType === "resumeSubscription") {
    const contractId = formData.get("contractId");
    const response = await admin.graphql(
      `#graphql
      mutation ResumeSubscription($id: ID!) {
        subscriptionContractActivate(subscriptionContractId: $id) {
          contract {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { id: contractId } }
    );
    const data = await response.json();
    return { data };
  }

  return null;
};
const PLACEHOLDER_SKUS = ["ANE-PC01", "ANE-PC02", "ANE-PC03", "ANE-PC04"];

export default function Index() {
  const fetcher = useFetcher();
  const { mappings, contracts } = useLoaderData();
  const actionData = useActionData();
  const [skuInputs, setSkuInputs] = useState({});

  useEffect(() => {
    const initialInputs = {};
    PLACEHOLDER_SKUS.forEach(sku => {
      const mapping = mappings.find(m => m.placeholderSku === sku);
      if (mapping) {
        try {
          const arr = JSON.parse(mapping.shippableSkus);
          initialInputs[sku] = arr.join(", ");
        } catch(e) {
          initialInputs[sku] = "";
        }
      } else {
        initialInputs[sku] = "";
      }
    });
    setSkuInputs(initialInputs);
  }, [mappings]);

  const handleSave = (placeholderSku) => {
    fetcher.submit(
      { actionType: "saveMapping", placeholderSku, shippableSkus: skuInputs[placeholderSku] },
      { method: "POST" }
    );
  };

  const handleCreateSellingPlans = () => {
    fetcher.submit(
      { actionType: "createSellingPlans" },
      { method: "POST" }
    );
  };

  const isLoading = fetcher.state === "submitting";

  const sellingPlanResult = actionData?.data?.data?.sellingPlanGroupCreate;

  return (
    <Page title="Friends of Ane Prepaid">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {sellingPlanResult?.sellingPlanGroup && (
              <Banner title="Selling Plan Created" tone="success">
                <p>The "6-Month Prepaid, Monthly Delivery" selling plan was successfully created! You must now attach it to your placeholder product in the Shopify Admin.</p>
              </Banner>
            )}
            {sellingPlanResult?.userErrors?.length > 0 && (
              <Banner title="Error creating selling plan" tone="critical">
                <p>{sellingPlanResult.userErrors[0].message}</p>
              </Banner>
            )}
            <Card>
              <BlockStack gap="500">
                <Text as="h2" variant="headingMd">
                  Prepaid Placeholder Mappings
                </Text>
                <Text variant="bodyMd" as="p">
                  Map your 4 special placeholder SKUs to the actual shippable SKUs. 
                  When a customer purchases a 6-month prepaid subscription for a placeholder SKU, 
                  the app will automatically swap it out for the shippable SKUs below in the subscription contract.
                </Text>
                
                {PLACEHOLDER_SKUS.map(sku => (
                  <Box key={sku} paddingBlockStart="200">
                    <InlineStack align="space-between" blockAlign="center" gap="400">
                      <div style={{width: '150px'}}>
                        <Text variant="bodyMd" fontWeight="bold">{sku}</Text>
                      </div>
                      <div style={{flexGrow: 1}}>
                        <TextField
                          labelHidden
                          label="Shippable SKUs"
                          value={skuInputs[sku]}
                          onChange={(val) => setSkuInputs(prev => ({...prev, [sku]: val}))}
                          placeholder="e.g. ITEM-01, ITEM-02, ITEM-03"
                          autoComplete="off"
                        />
                      </div>
                      <Button onClick={() => handleSave(sku)} loading={isLoading}>Save</Button>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </Card>
            
            <Card>
              <BlockStack gap="500">
                <Text as="h2" variant="headingMd">
                  Create Prepaid Selling Plan
                </Text>
                <Text variant="bodyMd" as="p">
                  This will create the 6-Month Prepaid Selling Plan in your store (Billed every 6 months, delivered every 1 month).
                  After creating it, you must manually attach this selling plan to your "Friends of Ane" placeholder variants in the Shopify Admin.
                </Text>
                <InlineStack>
                  <Button variant="primary" onClick={handleCreateSellingPlans} loading={isLoading}>
                    Create Selling Plan Group
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="500">
                <Text as="h2" variant="headingMd">
                  Active Subscriptions
                </Text>
                <DataTable
                  columnContentTypes={[
                    'text',
                    'text',
                    'numeric',
                    'text',
                    'text',
                    'text',
                  ]}
                  headings={[
                    'Customer Name',
                    'Start Month',
                    'Orders Left (of 6)',
                    'Next Order Date',
                    'Status',
                    'Actions',
                  ]}
                  rows={contracts.map((c) => {
                    const generatedOrders = c.orders?.edges?.length || 0;
                    const ordersLeft = Math.max(0, 6 - generatedOrders);
                    const startDate = new Date(c.createdAt).toLocaleDateString();
                    const nextDate = c.nextBillingDate ? new Date(c.nextBillingDate).toLocaleDateString() : 'N/A';
                    
                    const isPaused = c.status === "PAUSED";
                    
                    return [
                      `${c.customer?.firstName || ''} ${c.customer?.lastName || ''}`,
                      startDate,
                      ordersLeft.toString(),
                      nextDate,
                      <Badge tone={isPaused ? "warning" : "success"}>{c.status}</Badge>,
                      <Button
                        size="micro"
                        onClick={() => fetcher.submit({ actionType: isPaused ? "resumeSubscription" : "pauseSubscription", contractId: c.id }, { method: "POST" })}
                        loading={isLoading}
                      >
                        {isPaused ? "Resume" : "Pause"}
                      </Button>
                    ];
                  })}
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
