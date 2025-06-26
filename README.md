# basebase

A NodeJS GraphQL server for everyone.

## Features

- Express.js with GraphQL Yoga
- Native MongoDB driver integration
- Schema-less document storage
- TypeScript support
- Dynamic collection and field support

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=4000
   MONGODB_URI=your_mongodb_connection_string
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## GraphQL API

The server will be running at `http://localhost:4000/graphql` with GraphiQL interface enabled.

### Available Operations

- Query:
  - `documents(collection: String!, filter: JSON): [Document!]!`: Get all documents from a collection
  - `document(collection: String!, id: ID!): Document`: Get document by ID from a collection
- Mutation:
  - `createDocument(collection: String!, data: JSON!): Document!`: Create a new document
  - `updateDocument(collection: String!, id: ID!, data: JSON!): Document`: Update an existing document
  - `deleteDocument(collection: String!, id: ID!): Boolean!`: Delete a document

### Example Usage

```graphql
# Create a document in the "users" collection
mutation {
  createDocument(
    collection: "users",
    data: {
      name: "John Doe",
      email: "john@example.com",
      customField: "value"
    }
  ) {
    id
    data
  }
}

# Query documents with a filter
query {
  documents(
    collection: "users",
    filter: {
      "email": { "$exists": true }
    }
  ) {
    id
    data
  }
}
```
