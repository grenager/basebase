import { Db, ObjectId } from "mongodb";
import { logger } from "./utils/logger";

export interface ResolverContext {
  db: Db;
  currentUser?: any;
}

export const defaultResolvers = {
  async getDocument(collection: string, id: string, context: ResolverContext) {
    const operation = `get${
      collection.charAt(0).toUpperCase() + collection.slice(1)
    }`;
    const isAuthorized = !!context.currentUser;
    let result;

    try {
      if (!isAuthorized) {
        throw new Error("Authentication required");
      }

      result = await context.db.collection(collection).findOne({
        _id: new ObjectId(id),
      });
      if (!result) return null;
      result = {
        id: result._id.toString(),
        ...result,
      };
      return result;
    } catch (error) {
      result = error;
      throw error;
    } finally {
      logger.graphql(operation, { id }, isAuthorized, result);
    }
  },

  async getDocuments(collection: string, context: ResolverContext) {
    const operation = `getAll${
      collection.charAt(0).toUpperCase() + collection.slice(1)
    }s`;
    const isAuthorized = !!context.currentUser;
    let result;

    try {
      if (!isAuthorized) {
        throw new Error("Authentication required");
      }

      const docs = await context.db.collection(collection).find().toArray();
      result = docs.map((doc) => ({
        id: doc._id.toString(),
        ...doc,
      }));
      return result;
    } catch (error) {
      result = error;
      throw error;
    } finally {
      logger.graphql(operation, {}, isAuthorized, result);
    }
  },

  async createDocument(
    collection: string,
    data: Record<string, any>,
    context: ResolverContext
  ) {
    const operation = `create${
      collection.charAt(0).toUpperCase() + collection.slice(1)
    }`;
    const isAuthorized = !!context.currentUser;
    let result;

    try {
      if (!isAuthorized) {
        throw new Error("Authentication required");
      }

      const { id, ...insertData } = data; // Remove id if present
      const dbResult = await context.db
        .collection(collection)
        .insertOne(insertData);
      result = {
        id: dbResult.insertedId.toString(),
        ...insertData,
      };
      return result;
    } catch (error) {
      result = error;
      throw error;
    } finally {
      logger.graphql(operation, { data }, isAuthorized, result);
    }
  },

  async updateDocument(
    collection: string,
    id: string,
    data: Record<string, any>,
    context: ResolverContext
  ) {
    const operation = `update${
      collection.charAt(0).toUpperCase() + collection.slice(1)
    }`;
    const isAuthorized = !!context.currentUser;
    let result;

    try {
      if (!isAuthorized) {
        throw new Error("Authentication required");
      }

      const { id: _, ...updateData } = data; // Remove id if present
      const dbResult = await context.db
        .collection(collection)
        .findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updateData },
          { returnDocument: "after" }
        );
      if (!dbResult) return null;
      result = {
        id: dbResult._id.toString(),
        ...dbResult,
      };
      return result;
    } catch (error) {
      result = error;
      throw error;
    } finally {
      logger.graphql(operation, { id, data }, isAuthorized, result);
    }
  },
};
