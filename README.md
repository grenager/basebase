# basebase

A NodeJS GraphQL server for everyone.

## Features

- Express.js with GraphQL Yoga
- Native MongoDB driver integration
- Schema-less document storage
- TypeScript support
- Dynamic collection and field support
- Phone verification with Twilio
- JWT Authentication

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
   JWT_SECRET=your-secret-key-min-32-chars
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_PHONE_NUMBER=your_twilio_phone_number
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## Authentication

### Getting a Token (New Users)

New users need to verify their phone number to get a JWT token. This is a two-step process:

1. Start phone verification:

```graphql
mutation {
  startPhoneVerification(phone: "+1234567890", name: "John Doe")
}
```

This will send a 6-digit code to the provided phone number via SMS.

2. Verify the code and get your token:

```graphql
mutation {
  verifyPhoneAndLogin(
    phone: "+1234567890"
    code: "123456" # The code you received via SMS
  )
}
```

This will return a JWT token if the code is correct.

### Using Your Token

For all subsequent API requests:

1. Add the JWT token to your HTTP headers:

```json
{
  "Authorization": "Bearer your.jwt.token"
}
```

2. The server will automatically authenticate your request and provide access to your user data.

Notes:

- Tokens are valid for one year
- Keep your token secure and never share it
- One verification attempt per phone number at a time
- Verification codes expire after 10 minutes

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
  - `startPhoneVerification(phone: String!, name: String!): Boolean!`: Start phone verification
  - `verifyPhoneAndLogin(phone: String!, code: String!): String`: Verify phone and get JWT token

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
