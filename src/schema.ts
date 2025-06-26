import { createSchema } from "graphql-yoga";
import { Collection, ObjectId, Db } from "mongodb";

// Type for our MongoDB client that will be injected via context
export interface Context {
  db: Db;
}

export const schema = createSchema({
  typeDefs: /* GraphQL */ `
    scalar JSON

    type Document {
      id: ID!
      data: JSON!
    }

    type Query {
      documents(collection: String!, filter: JSON): [Document!]!
      document(collection: String!, id: ID!): Document
    }

    type Mutation {
      createDocument(collection: String!, data: JSON!): Document!
      updateDocument(collection: String!, id: ID!, data: JSON!): Document
      deleteDocument(collection: String!, id: ID!): Boolean!
    }
  `,
  resolvers: {
    Document: {
      id: (parent: any) => parent._id.toString(),
      data: (parent: any) => {
        const { _id, ...data } = parent;
        return data;
      },
    },
    Query: {
      documents: async (_, { collection, filter = {} }, context: Context) => {
        return await context.db.collection(collection).find(filter).toArray();
      },
      document: async (_, { collection, id }, context: Context) => {
        return await context.db.collection(collection).findOne({
          _id: new ObjectId(id),
        });
      },
    },
    Mutation: {
      createDocument: async (_, { collection, data }, context: Context) => {
        const result = await context.db.collection(collection).insertOne(data);
        return {
          _id: result.insertedId,
          ...data,
        };
      },
      updateDocument: async (_, { collection, id, data }, context: Context) => {
        const result = await context.db
          .collection(collection)
          .findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: data },
            { returnDocument: "after" }
          );
        return result;
      },
      deleteDocument: async (_, { collection, id }, context: Context) => {
        const result = await context.db.collection(collection).deleteOne({
          _id: new ObjectId(id),
        });
        return result.deletedCount === 1;
      },
    },
  },
});
