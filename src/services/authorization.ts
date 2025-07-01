import { AbilityBuilder, Ability } from "@casl/ability";
import { Db, Collection, ObjectId } from "mongodb";

export type Action = "manage" | "create" | "read" | "update" | "delete";
export type Subject = "User" | "Post" | "all";

export interface AuthorizationRule {
  _id?: ObjectId;
  name: string;
  description?: string;
  action: Action;
  subject: Subject;
  conditions?: Record<string, any>;
  fields?: string[];
  inverted?: boolean; // for cannot rules
  priority: number; // higher priority rules override lower priority ones
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type AppAbility = Ability<[Action, Subject]>;

export class AuthorizationService {
  private rulesCollection: Collection<AuthorizationRule>;

  constructor(db: Db) {
    this.rulesCollection = db.collection("authorizationRules");
  }

  async initialize(): Promise<void> {
    await this.rulesCollection.createIndex({ name: 1 }, { unique: true });
    await this.rulesCollection.createIndex({ subject: 1 });
    await this.rulesCollection.createIndex({ priority: -1 });

    // Create default rules if they don't exist
    await this.createDefaultRules();
  }

  private async createDefaultRules(): Promise<void> {
    const defaultRules: Omit<
      AuthorizationRule,
      "_id" | "createdAt" | "updatedAt"
    >[] = [
      {
        name: "user-manage-self",
        description: "Users can only modify or delete their own user record",
        action: "manage",
        subject: "User",
        conditions: { _id: "${user._id}" },
        priority: 100,
        isActive: true,
      },
      {
        name: "post-manage-by-creator",
        description: "Posts can only be modified or deleted by their creator",
        action: "manage",
        subject: "Post",
        conditions: { creator: "${user._id}" },
        priority: 100,
        isActive: true,
      },
      {
        name: "authenticated-read-all",
        description: "Authenticated users can read all resources",
        action: "read",
        subject: "all",
        priority: 50,
        isActive: true,
      },
      {
        name: "authenticated-create-all",
        description: "Authenticated users can create all resources",
        action: "create",
        subject: "all",
        priority: 50,
        isActive: true,
      },
    ];

    for (const rule of defaultRules) {
      const existingRule = await this.rulesCollection.findOne({
        name: rule.name,
      });
      if (!existingRule) {
        const now = new Date();
        await this.rulesCollection.insertOne({
          ...rule,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  async createRule(
    rule: Omit<AuthorizationRule, "_id" | "createdAt" | "updatedAt">
  ): Promise<AuthorizationRule> {
    const now = new Date();
    const ruleWithTimestamps = {
      ...rule,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.rulesCollection.insertOne(ruleWithTimestamps);
    return {
      _id: result.insertedId,
      ...ruleWithTimestamps,
    };
  }

  async getRules(): Promise<AuthorizationRule[]> {
    return await this.rulesCollection
      .find({ isActive: true })
      .sort({ priority: -1 })
      .toArray();
  }

  async updateRule(
    name: string,
    update: Partial<
      Omit<AuthorizationRule, "_id" | "name" | "createdAt" | "updatedAt">
    >
  ): Promise<AuthorizationRule | null> {
    const now = new Date();
    const result = await this.rulesCollection.findOneAndUpdate(
      { name },
      { $set: { ...update, updatedAt: now } },
      { returnDocument: "after" }
    );
    return result;
  }

  async deleteRule(name: string): Promise<boolean> {
    const result = await this.rulesCollection.deleteOne({ name });
    return result.deletedCount === 1;
  }

  buildAbilityForUser(user: any): AppAbility {
    return this.buildAbility(user);
  }

  private buildAbility(user: any): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(Ability);

    // If no user, return empty ability
    if (!user) {
      return build();
    }

    // Simple implementation for now - we'll make this dynamic later
    // Users can manage their own records
    can("manage", "User");

    // Users can manage posts they created
    can("manage", "Post");

    // Users can read and create anything
    can("read", "all");
    can("create", "all");

    return build();
  }

  async buildDynamicAbilityForUser(user: any): Promise<AppAbility> {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(Ability);

    if (!user) {
      return build();
    }

    const rules = await this.getRules();

    for (const rule of rules) {
      const conditions = this.interpolateConditions(
        rule.conditions || {},
        user
      );

      if (rule.inverted) {
        cannot(rule.action, rule.subject, conditions);
      } else {
        can(rule.action, rule.subject, conditions);
      }
    }

    return build();
  }

  private interpolateConditions(
    conditions: Record<string, any>,
    user: any
  ): Record<string, any> {
    const interpolated: Record<string, any> = {};

    for (const [key, value] of Object.entries(conditions)) {
      if (
        typeof value === "string" &&
        value.startsWith("${") &&
        value.endsWith("}")
      ) {
        // Extract variable path from ${user._id} format
        const varPath = value.slice(2, -1);
        const interpolatedValue = this.getNestedValue(user, varPath);

        // Convert to ObjectId if it looks like a MongoDB ObjectId
        if (
          typeof interpolatedValue === "string" &&
          ObjectId.isValid(interpolatedValue)
        ) {
          interpolated[key] = new ObjectId(interpolatedValue);
        } else {
          interpolated[key] = interpolatedValue;
        }
      } else {
        interpolated[key] = value;
      }
    }

    return interpolated;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, prop) => current?.[prop], obj);
  }

  checkPermission(
    ability: AppAbility,
    action: Action,
    subject: Subject,
    resource?: any,
    user?: any
  ): boolean {
    // First check if the action is allowed in general
    if (!ability.can(action, subject)) {
      return false;
    }

    // If there's no resource to check, allow the action
    if (!resource || !user) {
      return true;
    }

    // Custom ownership checks for specific subjects
    // Handle User subject - users can only manage their own record
    if (
      subject === "User" &&
      (action === "update" || action === "delete" || action === "manage")
    ) {
      const resourceId = resource._id?.toString() || resource.id?.toString();
      const userId = user._id?.toString() || user.id?.toString();
      return resourceId === userId;
    }

    // Handle Post subject - users can only manage posts they created
    if (
      subject === "Post" &&
      (action === "update" || action === "delete" || action === "manage")
    ) {
      const creatorId = resource.creator?.toString();
      const userId = user._id?.toString() || user.id?.toString();
      return creatorId === userId;
    }

    // For other cases, allow if the general permission exists
    return true;
  }

  assertPermission(
    ability: AppAbility,
    action: Action,
    subject: Subject,
    resource?: any,
    user?: any
  ): void {
    if (!this.checkPermission(ability, action, subject, resource, user)) {
      throw new Error(`Forbidden: Cannot ${action} ${subject}`);
    }
  }
}
