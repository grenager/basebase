import { Db, ObjectId } from "mongodb";

export interface ResolverContext {
  db: Db;
}

export const defaultResolvers = {
  async getDocument(collection: string, id: string, context: ResolverContext) {
    try {
      const result = await context.db.collection(collection).findOne({
        _id: new ObjectId(id),
      });
      if (!result) return null;
      return {
        id: result._id.toString(),
        ...result,
      };
    } catch (error) {
      console.error(`Error in getDocument for ${collection}:`, error);
      throw error;
    }
  },

  async getDocuments(collection: string, context: ResolverContext) {
    try {
      const results = await context.db.collection(collection).find().toArray();
      return results.map((doc) => ({
        id: doc._id.toString(),
        ...doc,
      }));
    } catch (error) {
      console.error(`Error in getDocuments for ${collection}:`, error);
      throw error;
    }
  },

  async createDocument(
    collection: string,
    data: Record<string, any>,
    context: ResolverContext
  ) {
    try {
      const { id, ...insertData } = data; // Remove id if present
      const result = await context.db
        .collection(collection)
        .insertOne(insertData);
      return {
        id: result.insertedId.toString(),
        ...insertData,
      };
    } catch (error) {
      console.error(`Error in createDocument for ${collection}:`, error);
      throw error;
    }
  },

  async updateDocument(
    collection: string,
    id: string,
    data: Record<string, any>,
    context: ResolverContext
  ) {
    try {
      const { id: _, ...updateData } = data; // Remove id if present
      const result = await context.db
        .collection(collection)
        .findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updateData },
          { returnDocument: "after" }
        );
      if (!result) return null;
      return {
        id: result._id.toString(),
        ...result,
      };
    } catch (error) {
      console.error(`Error in updateDocument for ${collection}:`, error);
      throw error;
    }
  },
};
