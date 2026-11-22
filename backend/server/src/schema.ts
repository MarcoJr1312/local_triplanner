// Carga del schema GraphQL: el schema base (backend/graphql/schema.graphql, heredado
// del contrato original de AppSync) + extension local
// (searchLocations / locationDetails sobre el catalogo local).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo: backend/server/src -> backend/graphql. Container: /app/src -> /app/graphql.
const BASE_SCHEMA_PATH =
  [
    path.resolve(__dirname, '..', '..', 'graphql', 'schema.graphql'),
    path.resolve(__dirname, '..', 'graphql', 'schema.graphql'),
  ].find((candidate) => fs.existsSync(candidate)) ??
  path.resolve(__dirname, '..', '..', 'graphql', 'schema.graphql');

const EXTENSION = /* GraphQL */ `
extend type Query {
  searchLocations(q: String!, lat: Float, lng: Float): [Location!]!
  locationDetails(placeId: String!): Location
  locationById(id: ID!): Location
  getTripByCode(code: String!): TripPreview
  suggestionChats(tripId: ID!, day: String): [SuggestionChat!]!
  getMyInterests: [String!]!
  getLlmSettings: LlmSettings!
  getEmailSettings: EmailSettings!
  getLocationsSettings: LocationsSettings!
}

type TripPreview {
  id: ID!
  name: String!
  destinationName: String
  ownerName: String
  invitedEmail: String!
}

extend type Mutation {
  sendTripInvite(tripId: ID!, email: String!, role: String): InviteResult
  joinTripWithCode(code: String!, email: String!, memberId: ID): Trip
  updateMyProfile(input: UpdateMyProfileInput!): UserProfile!
  addItemAttachment(tripId: ID, itemId: ID!, input: AddItemAttachmentInput!, viewerIds: [String!]): Attachment!
  updateAttachmentViewers(attachmentId: ID!, viewerIds: [String!]): Attachment!
  removeItemAttachment(attachmentId: ID!): Attachment
  favoriteLocation(locationId: ID!, favorite: Boolean!): FavoriteResult!
  saveSuggestionChat(tripId: ID!, day: String!, messages: [ChatMessageInput!]!): SuggestionChat!
  setItemReminder(itemId: ID!, enabled: Boolean!): TripItem!
  setMyInterests(terms: [String!]!): [String!]!
  updateLlmSettings(input: UpdateLlmSettingsInput!): LlmSettings!
  updateEmailSettings(input: UpdateEmailSettingsInput!): EmailSettings!
  updateLocationsSettings(input: UpdateLocationsSettingsInput!): LocationsSettings!
}

extend input CreateTripInput {
  timezone: String
}

type ChatMessage {
  role: String!
  content: String!
}

input ChatMessageInput {
  role: String!
  content: String!
}

type SuggestionChat {
  id: ID!
  tripId: ID!
  userId: ID!
  day: String!
  messages: [ChatMessage!]!
}

type FavoriteResult {
  locationId: ID!
  favorite: Boolean!
}

extend type Location {
  isFavorite: Boolean!
}

extend type Activity {
  isFavorite: Boolean!
}

input AddItemAttachmentInput {
  fileName: String!
  mimeType: String!
  dataUrl: String!
}

type Attachment {
  id: ID!
  fileName: String!
  mimeType: String!
  sizeBytes: Int!
  url: String!
  createdAt: AWSDateTime!
  uploadedByName: String
  viewerIds: [ID!]
  visibility: String!
  createdBy: ID!
}

extend type TripItem {
  attachments: [Attachment!]!
  isFavorite: Boolean!
  lat: Float
  lng: Float
  reminderEnabled: Int!
  locationText: String
}

extend input AddItemInput {
  locationText: String
}

extend input UpdateItemInput {
  locationText: String
}

extend type Trip {
  destinationLat: Float
  destinationLng: Float
  timezone: String!
}

input UpdateMyProfileInput {
  displayName: String!
  avatarDataUrl: String
  avatarRemove: Boolean
  language: String
}

extend type UserProfile {
  username: String!
  color: String
  avatarUrl: String
  language: String
}

extend type Member {
  username: String
  color: String
  avatarUrl: String
}

input CreateUserInput {
  username: String!
  password: String!
  displayName: String!
  language: String
}

type Notification {
  id: ID!
  type: String!
  tripId: ID!
  tripName: String!
  invitationId: ID!
  inviter: UserProfile
  role: MemberRole!
  status: String!
  createdAt: AWSDateTime!
  readAt: AWSDateTime
}

type LocalInviteResult {
  invitationId: ID!
  notificationId: ID!
  user: UserProfile!
  status: String!
}

extend type Query {
  getMyProfile: UserProfile
  listUsers(query: String): [UserProfile!]!
  getUserByUsername(username: String!): UserProfile
  myNotifications: [Notification!]!
}

extend type Mutation {
  login(username: String!, password: String!): UserProfile!
  createUser(input: CreateUserInput!): UserProfile!
  deleteUser(userId: ID!): Boolean!
  tripLocalInvite(tripId: ID!, username: String!, role: MemberRole!): LocalInviteResult!
  acceptTripLocalInvite(notificationId: ID!): Trip!
  declineTripLocalInvite(notificationId: ID!): Notification!
  markNotificationRead(notificationId: ID!): Notification!
}

extend type Subscription {
  onNotification: Notification!
}

type InviteResult {
  invitationId: ID!
  status: String!
  email: String!
  code: String!
  joinUrl: String!
}

type LlmSettings {
  provider: String!
  model: String!
  baseUrl: String!
  hasKey: Boolean!
  demo: Boolean!
}

input UpdateLlmSettingsInput {
  provider: String!
  apiKey: String
  model: String
  baseUrl: String
  clearKey: Boolean
}

type EmailSettings {
  provider: String!
  from: String!
  replyTo: String!
  hasKey: Boolean!
  ready: Boolean!
}

input UpdateEmailSettingsInput {
  provider: String!
  apiKey: String
  from: String
  replyTo: String
  clearKey: Boolean
}

type LocationsSettings {
  provider: String!
  hasKey: Boolean!
  ready: Boolean!
  cachedPlaces: Int!
}

input UpdateLocationsSettingsInput {
  provider: String!
  apiKey: String
  clearKey: Boolean
}

type Location {
  id: ID!
  name: String!
  category: String!
  rawType: String
  description: String
  lat: Float!
  lng: Float!
  address: String
  rating: Float
  ratingCount: Int
  phone: String
  priceLevel: String
  websiteUrl: String
  imageUrl: String
  cost: Float
  durationHours: Float
  tags: [String!]
  hours: AWSJSON
  socialLinks: AWSJSON
  source: String!
  placeId: String
}
`;

export function loadTypeDefs(): string {
  const base = fs.readFileSync(BASE_SCHEMA_PATH, 'utf8');
  // Scalars propios de AppSync (AWSDate/AWSDateTime/AWSJSON) no existen en
  // graphql-yoga: se definen localmente para poder cargar el schema tal cual.
  const AWS_SCALARS = /* GraphQL */ `
scalar AWSDate
scalar AWSDateTime
scalar AWSJSON
`;
  return AWS_SCALARS + base + '\n' + EXTENSION;
}
