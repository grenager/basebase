import { Db, ObjectId } from "mongodb";
import { logger } from "./utils/logger";
import { GraphQLTypeDefinition, isCustomType } from "./graphqlTypes";

export interface ResolverContext {
  db: Db;
  currentUser?: any;
}

// Helper function to convert custom type fields to ObjectIds for storage
function convertToObjectIds(
  data: Record<string, any>,
  typeDefinition: GraphQLTypeDefinition
): Record<string, any> {
  const converted = { ...data };

  for (const field of typeDefinition.fields) {
    if (field.name in converted && isCustomType(field.type)) {
      const value = converted[field.name];

      if (field.isList) {
        // Handle array of IDs
        if (Array.isArray(value)) {
          converted[field.name] = value.map((id: string) => new ObjectId(id));
        }
      } else {
        // Handle single ID
        if (value) {
          converted[field.name] = new ObjectId(value);
        }
      }
    }
  }

  return converted;
}

// Helper function to populate ObjectIds with full objects for retrieval
async function populateReferences(
  document: Record<string, any>,
  typeDefinition: GraphQLTypeDefinition,
  db: Db
): Promise<Record<string, any>> {
  const populated = { ...document };

  for (const field of typeDefinition.fields) {
    if (field.name in populated && isCustomType(field.type)) {
      const value = populated[field.name];
      const referencedCollection = `${field.type.toLowerCase()}s`;

      if (field.isList) {
        // Handle array of ObjectIds
        if (Array.isArray(value) && value.length > 0) {
          const objectIds = value.filter((id) => ObjectId.isValid(id));
          if (objectIds.length > 0) {
            const referencedDocs = await db
              .collection(referencedCollection)
              .find({ _id: { $in: objectIds } })
              .toArray();

            populated[field.name] = referencedDocs.map((doc) => {
              const { _id, ...docWithoutId } = doc;
              return {
                id: _id.toString(),
                ...docWithoutId,
              };
            });
          }
        }
      } else {
        // Handle single ObjectId
        if (value && ObjectId.isValid(value)) {
          const referencedDoc = await db
            .collection(referencedCollection)
            .findOne({ _id: value });

          if (referencedDoc) {
            const { _id, ...docWithoutId } = referencedDoc;
            populated[field.name] = {
              id: _id.toString(),
              ...docWithoutId,
            };
          }
        }
      }
    }
  }

  return populated;
}

export const defaultResolvers = {
  async getDocument(
    collection: string,
    id: string,
    context: ResolverContext,
    typeDefinition?: GraphQLTypeDefinition
  ) {
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

      // Convert _id to id and remove _id field
      const { _id, ...docWithoutId } = result;
      result = {
        id: _id.toString(),
        ...docWithoutId,
      };

      // Populate references if type definition is provided
      if (typeDefinition) {
        result = await populateReferences(result, typeDefinition, context.db);
      }

      return result;
    } catch (error) {
      result = error;
      throw error;
    } finally {
      logger.graphql(operation, { id }, isAuthorized, result);
    }
  },

  async getDocuments(
    collection: string,
    context: ResolverContext,
    typeDefinition?: GraphQLTypeDefinition
  ) {
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
      result = docs.map((doc) => {
        const { _id, ...docWithoutId } = doc;
        return {
          id: _id.toString(),
          ...docWithoutId,
        };
      });

      // Populate references if type definition is provided
      if (typeDefinition) {
        result = await Promise.all(
          result.map((doc) =>
            populateReferences(doc, typeDefinition, context.db)
          )
        );
      }

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
    context: ResolverContext,
    typeDefinition?: GraphQLTypeDefinition
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

      const { id, creator, ...insertData } = data; // Remove id and creator if present

      // Automatically add creator field (except for User collection)
      const dataToInsert =
        collection === "users"
          ? insertData
          : {
              ...insertData,
              creator: new ObjectId(context.currentUser._id),
            };

      // Convert custom type fields to ObjectIds for storage
      const convertedData = typeDefinition
        ? convertToObjectIds(dataToInsert, typeDefinition)
        : dataToInsert;

      const dbResult = await context.db
        .collection(collection)
        .insertOne(convertedData);

      result = {
        id: dbResult.insertedId.toString(),
        ...insertData, // Return original data format for GraphQL response
        ...(collection !== "users" && { creator: context.currentUser }), // Add creator info for GraphQL response (except for User type)
      };

      // Populate references if type definition is provided
      if (typeDefinition) {
        result = await populateReferences(result, typeDefinition, context.db);
      }

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
    context: ResolverContext,
    typeDefinition?: GraphQLTypeDefinition
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

      // Convert custom type fields to ObjectIds for storage
      const convertedData = typeDefinition
        ? convertToObjectIds(updateData, typeDefinition)
        : updateData;

      const dbResult = await context.db
        .collection(collection)
        .findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: convertedData },
          { returnDocument: "after" }
        );

      if (!dbResult) return null;

      // Convert _id to id and remove _id field
      const { _id, ...docWithoutId } = dbResult;
      result = {
        id: _id.toString(),
        ...docWithoutId,
      };

      // Populate references if type definition is provided
      if (typeDefinition) {
        result = await populateReferences(result, typeDefinition, context.db);
      }

      return result;
    } catch (error) {
      result = error;
      throw error;
    } finally {
      logger.graphql(operation, { id, data }, isAuthorized, result);
    }
  },

  async addToArray(
    collection: string,
    id: string,
    fieldName: string,
    itemId: string,
    context: ResolverContext,
    typeDefinition?: GraphQLTypeDefinition
  ) {
    const operation = `add${
      collection.charAt(0).toUpperCase() + collection.slice(1)
    }${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;
    const isAuthorized = !!context.currentUser;
    let result;

    try {
      if (!isAuthorized) {
        throw new Error("Authentication required");
      }

      // Convert itemId to ObjectId if it's a custom type reference
      let convertedItem: any = itemId;
      if (typeDefinition) {
        const field = typeDefinition.fields.find((f) => f.name === fieldName);
        if (field && isCustomType(field.type)) {
          convertedItem = new ObjectId(itemId);
        }
      }

      const dbResult = await context.db
        .collection(collection)
        .findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $addToSet: { [fieldName]: convertedItem } },
          { returnDocument: "after" }
        );

      if (!dbResult) return null;

      // Convert _id to id and remove _id field
      const { _id, ...docWithoutId } = dbResult;
      result = {
        id: _id.toString(),
        ...docWithoutId,
      };

      // Populate references if type definition is provided
      if (typeDefinition) {
        result = await populateReferences(result, typeDefinition, context.db);
      }

      return result;
    } catch (error) {
      result = error;
      throw error;
    } finally {
      logger.graphql(operation, { id, itemId }, isAuthorized, result);
    }
  },

  async removeFromArray(
    collection: string,
    id: string,
    fieldName: string,
    itemId: string,
    context: ResolverContext,
    typeDefinition?: GraphQLTypeDefinition
  ) {
    const operation = `remove${
      collection.charAt(0).toUpperCase() + collection.slice(1)
    }${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;
    const isAuthorized = !!context.currentUser;
    let result;

    try {
      if (!isAuthorized) {
        throw new Error("Authentication required");
      }

      // Convert itemId to ObjectId if it's a custom type reference
      let convertedItem: any = itemId;
      if (typeDefinition) {
        const field = typeDefinition.fields.find((f) => f.name === fieldName);
        if (field && isCustomType(field.type)) {
          convertedItem = new ObjectId(itemId);
        }
      }

      const dbResult = await context.db
        .collection(collection)
        .findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $pull: { [fieldName]: convertedItem } },
          { returnDocument: "after" }
        );

      if (!dbResult) return null;

      // Convert _id to id and remove _id field
      const { _id, ...docWithoutId } = dbResult;
      result = {
        id: _id.toString(),
        ...docWithoutId,
      };

      // Populate references if type definition is provided
      if (typeDefinition) {
        result = await populateReferences(result, typeDefinition, context.db);
      }

      return result;
    } catch (error) {
      result = error;
      throw error;
    } finally {
      logger.graphql(operation, { id, itemId }, isAuthorized, result);
    }
  },
};
