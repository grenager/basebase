import { createSchema } from "graphql-yoga";
import { User, IUser } from "./models/User";

export const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type User {
      id: ID!
      email: String!
      name: String!
      createdAt: String!
      updatedAt: String!
    }

    type Query {
      users: [User!]!
      user(id: ID!): User
    }

    input CreateUserInput {
      email: String!
      name: String!
    }

    input UpdateUserInput {
      email: String
      name: String
    }

    type Mutation {
      createUser(input: CreateUserInput!): User!
      updateUser(id: ID!, input: UpdateUserInput!): User
      deleteUser(id: ID!): Boolean!
    }
  `,
  resolvers: {
    Query: {
      users: async () => {
        return await User.find();
      },
      user: async (_, { id }) => {
        return await User.findById(id);
      },
    },
    Mutation: {
      createUser: async (_, { input }) => {
        const user = new User(input);
        return await user.save();
      },
      updateUser: async (_, { id, input }) => {
        return await User.findByIdAndUpdate(id, input, { new: true });
      },
      deleteUser: async (_, { id }) => {
        const result = await User.findByIdAndDelete(id);
        return !!result;
      },
    },
  },
});
