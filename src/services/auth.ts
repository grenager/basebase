import dotenv from "dotenv";
dotenv.config();
import { Db, ObjectId } from "mongodb";
import jwt from "jsonwebtoken";
import twilio from "twilio";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const VERIFICATION_CODE_EXPIRY = 10 * 60 * 1000; // 10 minutes
const JWT_EXPIRY = "365d"; // One year

if (
  !process.env.TWILIO_ACCOUNT_SID ||
  !process.env.TWILIO_AUTH_TOKEN ||
  !process.env.TWILIO_PHONE_NUMBER
) {
  throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
} else {
  console.log(
    "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER are set! Good to go!"
  );
}

// Initialize Twilio client
const twilioClient = (() => {
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    // Test the client by accessing a property
    if (!client.messages) {
      throw new Error("Failed to initialize Twilio client properly");
    }

    console.log("Twilio client initialized successfully");
    return client;
  } catch (error) {
    console.error("Error initializing Twilio client:", error);
    return null;
  }
})();

interface VerificationAttempt {
  phone: string;
  code: string;
  expiresAt: Date;
  name: string;
}

export class AuthService {
  private db: Db;
  private verificationAttemptsCollection;

  constructor(db: Db) {
    this.db = db;
    this.verificationAttemptsCollection = db.collection<VerificationAttempt>(
      "verificationAttempts"
    );
  }

  async initialize() {
    // Create TTL index for verification attempts
    await this.verificationAttemptsCollection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    );
    // Create unique index on phone for verification attempts
    await this.verificationAttemptsCollection.createIndex(
      { phone: 1 },
      { unique: true }
    );

    // Ensure users collection has the correct indexes
    const usersCollection = this.db.collection("users");
    // Drop any existing email index if it exists
    try {
      await usersCollection.dropIndex("email_1");
    } catch (error) {
      // Index might not exist, that's fine
    }
    // Create unique index on phone for users
    await usersCollection.createIndex({ phone: 1 }, { unique: true });
  }

  generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async startPhoneVerification(phone: string, name: string): Promise<boolean> {
    if (!twilioClient) {
      throw new Error(
        "Twilio is not properly configured. Please check environment variables."
      );
    }

    const code = this.generateVerificationCode();
    const expiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY);

    try {
      // Send SMS via Twilio
      await twilioClient.messages.create({
        body: `Your verification code is: ${code}`,
        to: phone,
        from: process.env.TWILIO_PHONE_NUMBER,
      });

      // Store verification attempt
      await this.verificationAttemptsCollection.updateOne(
        { phone },
        {
          $set: {
            code,
            expiresAt,
            name,
          },
        },
        { upsert: true }
      );

      return true;
    } catch (error) {
      console.error("Error sending verification code:", error);
      throw new Error(
        error instanceof Error
          ? error.message
          : "Failed to send verification code"
      );
    }
  }

  async verifyPhoneAndCreateUser(
    phone: string,
    code: string
  ): Promise<string | null> {
    const attempt = await this.verificationAttemptsCollection.findOne({
      phone,
    });

    if (!attempt || attempt.code !== code) {
      return null;
    }

    try {
      // Check if user already exists
      const existingUser = await this.db.collection("users").findOne({ phone });

      let userId: string;
      if (existingUser) {
        // User exists, use their ID
        userId = existingUser._id.toString();
        // Optionally update their name if it changed
        if (existingUser.name !== attempt.name) {
          await this.db
            .collection("users")
            .updateOne(
              { _id: existingUser._id },
              { $set: { name: attempt.name } }
            );
        }
      } else {
        // Create new user
        const result = await this.db.collection("users").insertOne({
          name: attempt.name,
          phone,
          createdAt: new Date(),
        });
        userId = result.insertedId.toString();
      }

      // Delete verification attempt
      await this.verificationAttemptsCollection.deleteOne({ phone });

      // Generate JWT
      return this.generateToken(userId);
    } catch (error) {
      console.error("Error creating/updating user:", error);
      return null;
    }
  }

  generateToken(userId: string): string {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  }

  async getUserFromToken(token: string): Promise<any | null> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      return await this.db.collection("users").findOne({
        _id: new ObjectId(decoded.userId),
      });
    } catch (error) {
      return null;
    }
  }
}
