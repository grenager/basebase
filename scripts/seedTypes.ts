import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { GraphQLTypeManager } from "../src/graphqlTypes";

// Load environment variables
dotenv.config();

async function seedTypes() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI must be defined in environment variables");
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const typeManager = new GraphQLTypeManager(db);
    await typeManager.initialize();

    // User type definition
    const userType = {
      name: "User",
      description: "A user in the system",
      fields: [
        { name: "id", type: "ID", isList: false, isRequired: true },
        { name: "name", type: "String", isList: false, isRequired: true },
        { name: "phone", type: "String", isList: false, isRequired: true },
        { name: "email", type: "String", isList: false, isRequired: false },
      ],
    };

    // App type definition
    const appType = {
      name: "App",
      description: "An application in the system",
      fields: [
        { name: "id", type: "ID", isList: false, isRequired: true },
        { name: "githubUrl", type: "String", isList: false, isRequired: true },
        { name: "ownerId", type: "ID", isList: false, isRequired: true },
      ],
    };

    // Update or create User type
    const existingUserType = await typeManager.getGraphQLTypeByName("User");
    if (existingUserType) {
      await typeManager.updateGraphQLType("User", userType);
      console.log("Updated User type");
    } else {
      await typeManager.addGraphQLType(userType);
      console.log("Added User type");
    }

    // Update or create App type
    const existingAppType = await typeManager.getGraphQLTypeByName("App");
    if (existingAppType) {
      await typeManager.updateGraphQLType("App", appType);
      console.log("Updated App type");
    } else {
      await typeManager.addGraphQLType(appType);
      console.log("Added App type");
    }

    // Verify the types were added/updated
    const types = await typeManager.getGraphQLTypes();
    console.log(
      "Current types in database:",
      types.map((t) => t.name).join(", ")
    );
  } catch (error) {
    console.error("Error seeding types:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("Disconnected from MongoDB");
  }
}

// Run the seed script
seedTypes();
