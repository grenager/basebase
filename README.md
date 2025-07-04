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

### Project Creation and API Key

1. First, sign in to BaseBase and create an Project:

```graphql
mutation {
  createProject(
    name: "My Project"
    description: "My awesome Project"
    githubUrl: "https://github.com/me/my-Project"
  ) {
    id
    name
    apiKey # Save this immediately - you won't be able to see it again!
  }
}
```

2. Save the returned API key securely - you'll need it for user authentication. If you lose it, you can generate a new one:

```graphql
mutation {
  generateProjectApiKey(ProjectId: "your_Project_id") {
    apiKey # Save this immediately - you won't be able to see it again!
  }
}
```

### Implementing User Authentication in Your Project

1. Add the BaseBase API key to your Project's environment:

```env
BASEBASE_API_KEY=your_api_key_here
```

2. When a user wants to sign in to your Project, start phone verification:

```graphql
mutation {
  requestCode(phone: "+1234567890", name: "John Doe")
}
```

3. After the user receives their code, verify it server-side using your Project's API key:

```graphql
mutation {
  verifyCode(
    phone: "+1234567890"
    code: "123456" # The code received via SMS
    ProjectApiKey: "your_api_key" # Your Project's API key
  )
}
```

This returns a JWT token specific to both the user and your Project. Store this token in the user's browser (e.g., localStorage) for future requests.

### Using Authentication

For API requests:

1. For user requests, use the JWT token:

```json
{
  "Authorization": "Bearer user.jwt.token"
}
```

2. For server-to-server requests, use your Project's API key:

```json
{
  "Authorization": "ApiKey your_api_key"
}
```

Notes:

- JWT tokens are valid for one year
- API keys are valid for one year by default
- Keep your tokens and API keys secure and never share them
- One verification attempt per phone number at a time
- Verification codes expire after 10 minutes
- Each Project gets its own authentication context
- Users authenticated in one Project cannot access resources from another Project
- API keys can be revoked using the `revokeProjectApiKey` mutation if compromised

## GraphQL API

The server will be running at `http://localhost:4000/graphql` by default.

### Type Management

You can dynamically create and manage GraphQL types using the following mutations:

1. Create a new type:

```graphql
mutation {
  createType(
    input: {
      name: "Product"
      description: "A product in the catalog"
      fields: [
        {
          name: "sku"
          type: "String"
          description: "Product SKU"
          isList: false
          isRequired: true
          unique: true # This field will have a unique index in MongoDB
        }
        {
          name: "name"
          type: "String"
          description: "Product name"
          isList: false
          isRequired: true
        }
      ]
    }
  )
}
```

Field Properties:

- `name`: The name of the field (required)
- `type`: The field type - can be a built-in scalar (ID, String, Int, Float, Boolean, Date) or a custom type name (required)
- `description`: Optional description for documentation
- `isList`: Whether the field is an array/list
- `isRequired`: Whether the field is required (non-null)
- `isListItemRequired`: For list fields, whether individual items are required
- `refType`: For ID fields, specifies which type this ID references
- `unique`: Whether this field should have a unique index in MongoDB (optional)

2. Add a field to an existing type:

```graphql
mutation {
  createFieldOnType(
    input: {
      typeName: "Product"
      field: {
        name: "barcode"
        type: "String"
        description: "Product barcode"
        isList: false
        isRequired: true
        unique: true # This field will have a unique index in MongoDB
      }
    }
  )
}
```

Note: When a field is marked as `unique: true`, the system automatically creates a unique index for that field in MongoDB. This ensures that no two documents in the collection can have the same value for that field.
