export type User = {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export type FriendRequest = {
  id: string;
  createdAt: string;
  user: User;
};

export type ConversationMember = {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
};

export type Conversation = {
  id: string;
  kind: "direct" | "group";
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  memberCount: number;
  members: ConversationMember[];
  lastMessagePreview: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  type: "text" | "image" | "file" | "voice";
  text: string;
  fileUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  createdAt: string;
  sender: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

export type Bootstrap = {
  currentUser: User;
  friends: User[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  conversations: Conversation[];
};
