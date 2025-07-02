import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import crypto from "crypto";

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI must be defined in environment variables");
}

async function generateApiKey(): Promise<string> {
  return crypto.randomBytes(32).toString("base64url");
}

async function main() {
  const client = new MongoClient(MONGODB_URI!, {
    ssl: true,
    tls: true,
    tlsAllowInvalidCertificates: false,
    retryWrites: true,
    w: "majority",
  });

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const apps = await db.collection("apps").find({}).toArray();

    if (apps.length === 0) {
      console.log("No apps found in the database");
      return;
    }

    console.log(`Found ${apps.length} apps`);

    for (const app of apps) {
      const apiKey = await generateApiKey();
      const apiKeyExpiresAt = new Date();
      apiKeyExpiresAt.setFullYear(apiKeyExpiresAt.getFullYear() + 1); // 1 year expiry

      await db.collection("apps").updateOne(
        { _id: app._id },
        {
          $set: {
            apiKey,
            apiKeyExpiresAt,
            updatedAt: new Date(),
          },
        }
      );

      console.log(`Updated app ${app.name} (${app._id})`);
      console.log(`API Key: ${apiKey}`);
      console.log("---");
    }

    console.log("All apps updated successfully");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
