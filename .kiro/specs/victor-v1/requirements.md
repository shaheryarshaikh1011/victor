# Requirements Document

## Introduction

VICTOR V1 is the foundation release of the VICTOR personal AI assistant, delivered as a responsive web application. In this version an authenticated user communicates with an AI through a polished chat interface. Chat conversations and messages are persisted per user in a PostgreSQL (Supabase) database. The backend (NestJS) mediates all AI calls through a provider abstraction that supports Google Gemini, Groq, and OpenRouter with basic fallback, and streams responses back to the frontend (Next.js). The frontend never communicates directly with AI providers, and API keys are never exposed to the client.

This document defines the requirements for VICTOR V1 only. Finance, voice, advanced memory, tasks, agents, documents, and autonomous actions are explicitly out of scope for this version, though the architecture is designed to remain extensible toward them.

## Glossary

- **VICTOR**: The overall personal AI assistant system comprising the frontend web application, the NestJS backend, and the Supabase database.
- **Web_Client**: The Next.js/React frontend that renders the authentication, chat, and settings interfaces.
- **Backend_API**: The NestJS REST API that handles authentication verification, conversation and message persistence, and AI orchestration.
- **Auth_Service**: The Backend_API component responsible for verifying user identity and session validity using Supabase authentication.
- **User_Profile**: The stored record describing an authenticated user, including a unique user identifier and profile attributes.
- **AI_Service**: The Backend_API facade that exposes generate and stream operations to the rest of the backend.
- **AI_Router**: The Backend_API component that selects an AI provider and model and performs fallback between providers.
- **AI_Provider**: An interface implemented by GeminiProvider, GroqProvider, and OpenRouterProvider, exposing `generate()`, `stream()`, and `getAvailableModels()`.
- **Conversation**: A persisted container owned by a single authenticated user that groups an ordered sequence of messages.
- **Message**: A persisted unit of chat content belonging to one Conversation, with a role of either user or assistant.
- **Authenticated_User_Id**: The user identifier derived by the Backend_API from a verified session, never accepted from the client request body.
- **Provider_Fallback**: The AI_Router behavior of attempting a secondary and then a tertiary AI_Provider when the primary provider fails or is rate limited.
- **Streaming_Response**: An AI-generated message delivered to the Web_Client incrementally as a sequence of content chunks.
- **Rate_Limit**: A configured maximum request rate enforced by the Backend_API for a given endpoint and user.

## Requirements

### Requirement 1: User Authentication

**User Story:** As a visitor, I want to sign up and log in securely, so that my conversations are private and tied to my identity.

#### Acceptance Criteria

1. WHEN a visitor submits valid signup credentials, THE Backend_API SHALL create a User_Profile associated with a unique Authenticated_User_Id.
2. IF a visitor submits signup credentials with an email that already exists, THEN THE Backend_API SHALL reject the request and return a conflict error.
3. WHEN a user submits valid login credentials, THE Auth_Service SHALL establish an authenticated session and return a session token to the Web_Client.
4. IF a request to a protected endpoint omits a valid session token, THEN THE Backend_API SHALL reject the request with an unauthorized error.
5. WHEN the Backend_API processes any authenticated request, THE Backend_API SHALL derive the Authenticated_User_Id from the verified session and SHALL ignore any user identifier present in the request body.

### Requirement 2: User Profile and Settings

**User Story:** As an authenticated user, I want to view my profile and adjust basic settings, so that I can control my AI provider and model preferences.

#### Acceptance Criteria

1. WHEN an authenticated user requests the profile resource, THE Backend_API SHALL return the User_Profile that matches the Authenticated_User_Id.
2. WHEN an authenticated user submits a settings update with a supported provider and model, THE Backend_API SHALL persist the settings for the Authenticated_User_Id.
3. IF an authenticated user submits a settings update referencing an unsupported provider or model, THEN THE Backend_API SHALL reject the request and return a validation error.
4. WHEN an authenticated user requests settings, THE Backend_API SHALL return the persisted settings for the Authenticated_User_Id.

### Requirement 3: Conversation Management

**User Story:** As an authenticated user, I want to create, list, and delete conversations, so that I can organize my chats with VICTOR.

#### Acceptance Criteria

1. WHEN an authenticated user creates a conversation, THE Backend_API SHALL persist a Conversation owned by the Authenticated_User_Id.
2. WHEN an authenticated user lists conversations, THE Backend_API SHALL return only the Conversations owned by the Authenticated_User_Id.
3. IF an authenticated user requests a Conversation that is not owned by the Authenticated_User_Id, THEN THE Backend_API SHALL reject the request with a forbidden error.
4. WHEN an authenticated user deletes an owned Conversation, THE Backend_API SHALL remove the Conversation and all Messages belonging to that Conversation.
5. IF an authenticated user attempts to delete a Conversation that is not owned by the Authenticated_User_Id, THEN THE Backend_API SHALL reject the request with a forbidden error and SHALL preserve the Conversation.

### Requirement 4: Message Persistence

**User Story:** As an authenticated user, I want my messages and VICTOR's replies saved, so that I can revisit past conversations.

#### Acceptance Criteria

1. WHEN an authenticated user sends a message to an owned Conversation, THE Backend_API SHALL persist a Message with the user role associated with that Conversation.
2. WHEN the AI_Service completes an assistant reply for an owned Conversation, THE Backend_API SHALL persist a Message with the assistant role associated with that Conversation.
3. WHEN an authenticated user requests the messages of an owned Conversation, THE Backend_API SHALL return the Messages of that Conversation ordered by creation time in ascending order.
4. IF an authenticated user requests messages of a Conversation that is not owned by the Authenticated_User_Id, THEN THE Backend_API SHALL reject the request with a forbidden error.

### Requirement 5: AI Provider Abstraction

**User Story:** As a system maintainer, I want a uniform AI provider interface, so that providers remain replaceable and are never called from the frontend.

#### Acceptance Criteria

1. THE AI_Service SHALL expose a `generate()` operation and a `stream()` operation to backend callers.
2. THE AI_Provider interface SHALL define `generate()`, `stream()`, and `getAvailableModels()` operations implemented by GeminiProvider, GroqProvider, and OpenRouterProvider.
3. WHEN the AI_Service serializes an AI request payload, THE AI_Service SHALL produce a payload that, when deserialized, yields a request equivalent to the original request.
4. WHERE the Web_Client requires an AI response, THE Web_Client SHALL request the response through the Backend_API rather than contacting an AI_Provider directly.
5. THE Backend_API SHALL read AI_Provider credentials from environment variables and SHALL exclude AI_Provider credentials from every response returned to the Web_Client.

### Requirement 6: AI Router and Fallback

**User Story:** As an authenticated user, I want VICTOR to stay responsive when a provider fails, so that I still receive answers.

#### Acceptance Criteria

1. WHEN the AI_Router receives a generate request, THE AI_Router SHALL select the AI_Provider and model configured for the Authenticated_User_Id.
2. IF the primary AI_Provider returns a failure or a Rate_Limit response, THEN THE AI_Router SHALL attempt the secondary AI_Provider and then the tertiary AI_Provider in order.
3. IF every configured AI_Provider returns a failure, THEN THE AI_Router SHALL return a single error result without attempting further providers.
4. THE AI_Router SHALL attempt each configured AI_Provider at most one time per request.

### Requirement 7: Streaming Chat Responses

**User Story:** As an authenticated user, I want VICTOR's reply to appear incrementally, so that the interface feels responsive.

#### Acceptance Criteria

1. WHEN an authenticated user sends a message that requests streaming, THE Backend_API SHALL deliver the assistant reply to the Web_Client as an ordered sequence of Streaming_Response chunks.
2. WHEN the Backend_API concatenates all Streaming_Response chunks of one assistant reply in delivery order, THE Backend_API SHALL produce content equal to the persisted assistant Message content.
3. WHILE a Streaming_Response is in progress, THE Web_Client SHALL display a loading state for the pending assistant Message.
4. IF the AI_Service reports an error during streaming, THEN THE Web_Client SHALL display an error state for the affected Message.

### Requirement 8: Chat Interface

**User Story:** As an authenticated user, I want a polished chat interface, so that I can converse with VICTOR comfortably on any device.

#### Acceptance Criteria

1. WHEN an authenticated user opens the chat route, THE Web_Client SHALL render a conversation sidebar, a message list, and a message input control.
2. WHEN the Web_Client renders a Message, THE Web_Client SHALL display the Message content together with a role indicator distinguishing user Messages from assistant Messages.
3. WHEN an authenticated user activates the copy control on an assistant Message, THE Web_Client SHALL place that Message content on the system clipboard.
4. WHEN an authenticated user activates the regenerate control on an assistant Message, THE Web_Client SHALL request a new assistant reply for the preceding user Message in the same Conversation.
5. WHERE the viewport width is at or below the mobile breakpoint, THE Web_Client SHALL present a layout in which the conversation sidebar is collapsible.

### Requirement 9: Request Validation and Rate Limiting

**User Story:** As a system maintainer, I want validated and rate-limited endpoints, so that the backend rejects malformed and abusive requests.

#### Acceptance Criteria

1. IF an authenticated request body fails schema validation, THEN THE Backend_API SHALL reject the request with a validation error and SHALL NOT persist any record from the request.
2. WHEN the request rate from an Authenticated_User_Id for a rate-limited endpoint exceeds the configured Rate_Limit, THE Backend_API SHALL reject the excess request with a too-many-requests error.
3. WHEN the Backend_API handles an unexpected error, THE Backend_API SHALL return a response that excludes internal stack details and SHALL record a log entry for the error.
