/**
 * MessagingService - Online Social & Messaging Architecture
 * Built for authenticated online players.
 * Zero fabricated dummy chats or fake "Mom" contacts.
 * Starts with authentic empty states and handles genuine user messaging threads.
 */

export interface ContactRecord {
  id: string;
  name: string;
  username: string;
  online: boolean;
  avatarColor?: string;
}

export interface ChatMessage {
  id: string;
  senderUsername: string;
  recipientUsername: string;
  text: string;
  timestamp: number;
}

export interface ConversationThread {
  contact: ContactRecord;
  lastMessage?: ChatMessage;
  unreadCount: number;
  messages: ChatMessage[];
}

export class MessagingService {
  private static instance: MessagingService;
  private contacts: ContactRecord[] = [];
  private messages: ChatMessage[] = [];

  public static getInstance(): MessagingService {
    if (!MessagingService.instance) {
      MessagingService.instance = new MessagingService();
    }
    return MessagingService.instance;
  }

  public getContacts(): ContactRecord[] {
    return [...this.contacts];
  }

  public getConversations(): ConversationThread[] {
    return this.contacts.map((contact) => {
      const threadMsgs = this.messages.filter(
        (m) =>
          m.senderUsername === contact.username || m.recipientUsername === contact.username
      );
      return {
        contact,
        messages: threadMsgs,
        lastMessage: threadMsgs[threadMsgs.length - 1],
        unreadCount: 0,
      };
    });
  }

  public addContact(contact: ContactRecord): void {
    if (!this.contacts.some((c) => c.username === contact.username)) {
      this.contacts.push(contact);
    }
  }

  public sendMessage(
    senderUsername: string,
    recipientUsername: string,
    text: string
  ): ChatMessage {
    const trimmed = text.trim();
    const cleanRecipient = recipientUsername.trim().toLowerCase().replace(/^@/, '');

    const msg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      senderUsername,
      recipientUsername: cleanRecipient,
      text: trimmed,
      timestamp: Date.now(),
    };

    this.messages.push(msg);

    // Auto-create contact if new
    if (!this.contacts.some((c) => c.username.toLowerCase() === cleanRecipient)) {
      this.contacts.push({
        id: `c_${Date.now()}`,
        name: `@${cleanRecipient}`,
        username: cleanRecipient,
        online: true,
      });
    }

    return msg;
  }
}

export const messagingService = MessagingService.getInstance();
