export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_chats: {
        Row: {
          created_at: string | null
          id: string
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          title?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string | null
          id: string
          role: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string | null
          id?: string
          role: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string | null
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "ai_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          id: string
          joined_at: string | null
          last_read_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          joined_at?: string | null
          last_read_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          joined_at?: string | null
          last_read_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          created_by: string
          id: string
          name: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          created_by: string
          id?: string
          name?: string | null
          type?: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string
          id?: string
          name?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          category: string
          contains_alcohol: boolean | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_available: boolean | null
          is_vegetarian: boolean | null
          name: string
          price: number
          restaurant_id: string
        }
        Insert: {
          category: string
          contains_alcohol?: boolean | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_vegetarian?: boolean | null
          name: string
          price: number
          restaurant_id: string
        }
        Update: {
          category?: string
          contains_alcohol?: boolean | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_vegetarian?: boolean | null
          name?: string
          price?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string | null
          id: string
          is_deleted: boolean | null
          media_url: string | null
          metadata: Json | null
          reply_to_id: string | null
          sender_id: string
          type: string
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          media_url?: string | null
          metadata?: Json | null
          reply_to_id?: string | null
          sender_id: string
          type?: string
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          media_url?: string | null
          metadata?: Json | null
          reply_to_id?: string | null
          sender_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moments_comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moments_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "moments_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moments_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moments_likes: {
        Row: {
          created_at: string | null
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moments_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "moments_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moments_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moments_posts: {
        Row: {
          comment_count: number | null
          content: string | null
          created_at: string | null
          id: string
          like_count: number | null
          location_name: string | null
          media_urls: string[] | null
          user_id: string
          visibility: string
        }
        Insert: {
          comment_count?: number | null
          content?: string | null
          created_at?: string | null
          id?: string
          like_count?: number | null
          location_name?: string | null
          media_urls?: string[] | null
          user_id: string
          visibility?: string
        }
        Update: {
          comment_count?: number | null
          content?: string | null
          created_at?: string | null
          id?: string
          like_count?: number | null
          location_name?: string | null
          media_urls?: string[] | null
          user_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "moments_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          delivery_address: string
          delivery_fee: number | null
          id: string
          items_json: Json
          payment_method: string
          payment_status: string
          restaurant_id: string
          status: string
          subtotal: number
          total: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          delivery_address: string
          delivery_fee?: number | null
          id?: string
          items_json: Json
          payment_method?: string
          payment_status?: string
          restaurant_id: string
          status?: string
          subtotal: number
          total: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          delivery_address?: string
          delivery_fee?: number | null
          id?: string
          items_json?: Json
          payment_method?: string
          payment_status?: string
          restaurant_id?: string
          status?: string
          subtotal?: number
          total?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          country_code: string | null
          created_at: string | null
          display_name: string
          id: string
          language: string | null
          omiq_wallet_address: string | null
          oniq_pay_enabled: boolean | null
          updated_at: string | null
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          country_code?: string | null
          created_at?: string | null
          display_name: string
          id: string
          language?: string | null
          omiq_wallet_address?: string | null
          oniq_pay_enabled?: boolean | null
          updated_at?: string | null
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          country_code?: string | null
          created_at?: string | null
          display_name?: string
          id?: string
          language?: string | null
          omiq_wallet_address?: string | null
          oniq_pay_enabled?: boolean | null
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      restaurants: {
        Row: {
          address: string
          created_at: string | null
          cuisine_type: string
          delivery_fee: number | null
          delivery_time_mins: number | null
          description: string | null
          id: string
          image_url: string | null
          is_open: boolean | null
          name: string
          rating: number | null
          review_count: number | null
        }
        Insert: {
          address: string
          created_at?: string | null
          cuisine_type: string
          delivery_fee?: number | null
          delivery_time_mins?: number | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_open?: boolean | null
          name: string
          rating?: number | null
          review_count?: number | null
        }
        Update: {
          address?: string
          created_at?: string | null
          cuisine_type?: string
          delivery_fee?: number | null
          delivery_time_mins?: number | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_open?: boolean | null
          name?: string
          rating?: number | null
          review_count?: number | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          created_at: string | null
          currency: string
          id: string
          metadata: Json | null
          note: string | null
          recipient_id: string | null
          sender_id: string | null
          status: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string
          id?: string
          metadata?: Json | null
          note?: string | null
          recipient_id?: string | null
          sender_id?: string | null
          status?: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string
          id?: string
          metadata?: Json | null
          note?: string | null
          recipient_id?: string | null
          sender_id?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          created_at: string | null
          fiat_balance: number | null
          id: string
          is_frozen: boolean | null
          omiq_balance: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          fiat_balance?: number | null
          id?: string
          is_frozen?: boolean | null
          omiq_balance?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          fiat_balance?: number | null
          id?: string
          is_frozen?: boolean | null
          omiq_balance?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      demo_top_up: { Args: { _amount: number }; Returns: number }
      find_or_create_direct_conversation: {
        Args: { other_user_id: string }
        Returns: string
      }
      is_conversation_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      mark_conversation_read: {
        Args: { _conversation_id: string }
        Returns: undefined
      }
      place_order: {
        Args: {
          _delivery_address: string
          _items: Json
          _restaurant_id: string
        }
        Returns: string
      }
      send_payment: {
        Args: { _amount: number; _note?: string; _recipient_username: string }
        Returns: string
      }
      toggle_moment_like: { Args: { _post_id: string }; Returns: boolean }
      unread_count: { Args: { _conversation_id: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
