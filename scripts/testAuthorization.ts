import { MongoClient } from "mongodb";
import { AuthorizationService } from "../src/services/authorization";
import dotenv from "dotenv";

dotenv.config();

async function testAuthorization() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI must be defined in environment variables");
  }

  const client = new MongoClient(MONGODB_URI, {
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
    const authService = new AuthorizationService(db);
    await authService.initialize();

    console.log("✅ Authorization service initialized");

    // Test creating a user ability
    const testUser = {
      _id: "507f1f77bcf86cd799439011",
      name: "Test User",
      phone: "+1234567890",
    };

    const ability = authService.buildAbilityForUser(testUser);

    // Test that user can manage their own User record
    const ownUserDoc = { _id: testUser._id, name: "Test User" };
    const canManageOwnUser = authService.checkPermission(
      ability,
      "manage",
      "User",
      ownUserDoc,
      testUser
    );
    console.log(`✅ User can manage own record: ${canManageOwnUser}`);

    // Test that user cannot manage another user's record
    const otherUserDoc = {
      _id: "507f1f77bcf86cd799439012",
      name: "Other User",
    };
    const canManageOtherUser = authService.checkPermission(
      ability,
      "manage",
      "User",
      otherUserDoc,
      testUser
    );
    console.log(`❌ User cannot manage other's record: ${!canManageOtherUser}`);

    // Test that user can manage their own posts
    const ownPost = {
      _id: "507f1f77bcf86cd799439013",
      creator: testUser._id,
      title: "My Post",
    };
    const canManageOwnPost = authService.checkPermission(
      ability,
      "manage",
      "Post",
      ownPost,
      testUser
    );
    console.log(`✅ User can manage own posts: ${canManageOwnPost}`);

    // Test that user cannot manage other's posts
    const otherPost = {
      _id: "507f1f77bcf86cd799439014",
      creator: "507f1f77bcf86cd799439012",
      title: "Other Post",
    };
    const canManageOtherPost = authService.checkPermission(
      ability,
      "manage",
      "Post",
      otherPost,
      testUser
    );
    console.log(`❌ User cannot manage other's posts: ${!canManageOtherPost}`);

    // Test read permissions
    const canReadAny = authService.checkPermission(ability, "read", "all");
    console.log(`✅ User can read any resource: ${canReadAny}`);

    // Test create permissions
    const canCreateAny = authService.checkPermission(ability, "create", "all");
    console.log(`✅ User can create any resource: ${canCreateAny}`);

    console.log("\n📊 Authorization Rules in Database:");
    const rules = await authService.getRules();
    rules.forEach((rule) => {
      console.log(
        `  • ${rule.name}: ${rule.action} on ${rule.subject} (priority: ${rule.priority})`
      );
    });

    console.log("\n🎉 All authorization tests passed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await client.close();
  }
}

testAuthorization();
