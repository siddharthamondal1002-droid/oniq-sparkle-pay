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
      admin_actions: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string
          id: string
          note: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          admin_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_actions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      bank_accounts: {
        Row: {
          account_last4: string
          bank_name: string
          created_at: string | null
          holder_name: string
          id: string
          ifsc: string
          is_primary: boolean
          nickname: string | null
          user_id: string
        }
        Insert: {
          account_last4: string
          bank_name: string
          created_at?: string | null
          holder_name: string
          id?: string
          ifsc: string
          is_primary?: boolean
          nickname?: string | null
          user_id: string
        }
        Update: {
          account_last4?: string
          bank_name?: string
          created_at?: string | null
          holder_name?: string
          id?: string
          ifsc?: string
          is_primary?: boolean
          nickname?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clips: {
        Row: {
          caption: string | null
          comment_count: number
          created_at: string | null
          hashtags: string[] | null
          id: string
          is_deleted: boolean
          like_count: number
          user_id: string
          video_url: string
          view_count: number
        }
        Insert: {
          caption?: string | null
          comment_count?: number
          created_at?: string | null
          hashtags?: string[] | null
          id?: string
          is_deleted?: boolean
          like_count?: number
          user_id: string
          video_url: string
          view_count?: number
        }
        Update: {
          caption?: string | null
          comment_count?: number
          created_at?: string | null
          hashtags?: string[] | null
          id?: string
          is_deleted?: boolean
          like_count?: number
          user_id?: string
          video_url?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "clips_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clips_comments: {
        Row: {
          clip_id: string
          content: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          clip_id: string
          content: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          clip_id?: string
          content?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clips_comments_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clips_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clips_likes: {
        Row: {
          clip_id: string
          created_at: string | null
          user_id: string
        }
        Insert: {
          clip_id: string
          created_at?: string | null
          user_id: string
        }
        Update: {
          clip_id?: string
          created_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clips_likes_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clips_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clips_views: {
        Row: {
          clip_id: string
          created_at: string | null
          user_id: string
        }
        Insert: {
          clip_id: string
          created_at?: string | null
          user_id: string
        }
        Update: {
          clip_id?: string
          created_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clips_views_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clips_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          description: string | null
          id: string
          is_public: boolean
          name: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          created_by: string
          description?: string | null
          id?: string
          is_public?: boolean
          name?: string | null
          type?: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          id?: string
          is_public?: boolean
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
      follows: {
        Row: {
          created_at: string | null
          followee_id: string
          follower_id: string
        }
        Insert: {
          created_at?: string | null
          followee_id: string
          follower_id: string
        }
        Update: {
          created_at?: string | null
          followee_id?: string
          follower_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          accepted_at: string | null
          created_at: string
          requested_by: string
          status: string
          user_a: string
          user_b: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          requested_by: string
          status?: string
          user_a: string
          user_b: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          requested_by?: string
          status?: string
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      learn_courses: {
        Row: {
          created_at: string
          description: string | null
          emoji: string
          id: string
          sort: number
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          emoji?: string
          id?: string
          sort?: number
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          emoji?: string
          id?: string
          sort?: number
          title?: string
        }
        Relationships: []
      }
      learn_lessons: {
        Row: {
          course_id: string
          created_at: string
          id: string
          sort: number
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          sort?: number
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          sort?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "learn_lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "learn_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      learn_progress: {
        Row: {
          completed_at: string | null
          lesson_id: string
          score: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          lesson_id: string
          score: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          lesson_id?: string
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learn_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "learn_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learn_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      learn_questions: {
        Row: {
          correct_index: number
          created_at: string
          id: string
          lesson_id: string
          options: string[]
          prompt: string
          sort: number
        }
        Insert: {
          correct_index: number
          created_at?: string
          id?: string
          lesson_id: string
          options: string[]
          prompt: string
          sort?: number
        }
        Update: {
          correct_index?: number
          created_at?: string
          id?: string
          lesson_id?: string
          options?: string[]
          prompt?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "learn_questions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "learn_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      learn_stats: {
        Row: {
          last_active: string | null
          streak: number
          user_id: string
          xp: number
        }
        Insert: {
          last_active?: string | null
          streak?: number
          user_id: string
          xp?: number
        }
        Update: {
          last_active?: string | null
          streak?: number
          user_id?: string
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "learn_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
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
          duration_s: number | null
          file_name: string | null
          file_size: number | null
          id: string
          is_ai: boolean
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
          duration_s?: number | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          is_ai?: boolean
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
          duration_s?: number | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          is_ai?: boolean
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
      payment_requests: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          note: string | null
          payer_id: string
          requester_id: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          note?: string | null
          payer_id: string
          requester_id: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          note?: string | null
          payer_id?: string
          requester_id?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_requester_id_fkey"
            columns: ["requester_id"]
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
          is_admin: boolean
          language: string | null
          last_policy_notice_at: string | null
          omiq_wallet_address: string | null
          oniq_pay_enabled: boolean | null
          updated_at: string | null
          upi_vpa: string | null
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          country_code?: string | null
          created_at?: string | null
          display_name: string
          id: string
          is_admin?: boolean
          language?: string | null
          last_policy_notice_at?: string | null
          omiq_wallet_address?: string | null
          oniq_pay_enabled?: boolean | null
          updated_at?: string | null
          upi_vpa?: string | null
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          country_code?: string | null
          created_at?: string | null
          display_name?: string
          id?: string
          is_admin?: boolean
          language?: string | null
          last_policy_notice_at?: string | null
          omiq_wallet_address?: string | null
          oniq_pay_enabled?: boolean | null
          updated_at?: string | null
          upi_vpa?: string | null
          username?: string
        }
        Relationships: []
      }
      red_packets: {
        Row: {
          amount: number
          created_at: string | null
          greeting: string
          id: string
          recipient_id: string
          resolved_at: string | null
          sender_id: string
          status: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          greeting?: string
          id?: string
          recipient_id: string
          resolved_at?: string | null
          sender_id: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          greeting?: string
          id?: string
          recipient_id?: string
          resolved_at?: string | null
          sender_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "red_packets_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "red_packets_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          conversation_id: string | null
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string | null
          resolution: string | null
          resolved_at: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      user_channels: {
        Row: {
          channel_id: string
          created_at: string
          name: string
          user_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          name: string
          user_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_channels_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_theme: {
        Row: {
          tile_skins: Json
          updated_at: string
          user_id: string
          wallpaper_url: string | null
        }
        Insert: {
          tile_skins?: Json
          updated_at?: string
          user_id: string
          wallpaper_url?: string | null
        }
        Update: {
          tile_skins?: Json
          updated_at?: string
          user_id?: string
          wallpaper_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_theme_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
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
      add_bank_account: {
        Args: {
          _account_number: string
          _bank_name: string
          _holder_name: string
          _ifsc: string
          _nickname?: string
        }
        Returns: string
      }
      add_group_members: {
        Args: { _conversation_id: string; _member_ids: string[] }
        Returns: undefined
      }
      admin_remove_content: {
        Args: { _note?: string; _target_id: string; _target_type: string }
        Returns: undefined
      }
      clips_feed: {
        Args: { _limit?: number; _offset?: number }
        Returns: {
          caption: string | null
          comment_count: number
          created_at: string | null
          hashtags: string[] | null
          id: string
          is_deleted: boolean
          like_count: number
          user_id: string
          video_url: string
          view_count: number
        }[]
        SetofOptions: {
          from: "*"
          to: "clips"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_lesson: {
        Args: { _lesson_id: string; _score: number }
        Returns: Json
      }
      create_channel: {
        Args: { _description: string; _is_public: boolean; _name: string }
        Returns: string
      }
      create_group: {
        Args: { _member_ids: string[]; _name: string }
        Returns: string
      }
      create_payment_request: {
        Args: { _amount: number; _from_username: string; _note?: string }
        Returns: string
      }
      demo_top_up: { Args: { _amount: number }; Returns: number }
      find_or_create_direct_conversation: {
        Args: { other_user_id: string }
        Returns: string
      }
      get_chat_list: {
        Args: never
        Returns: {
          avatar_url: string
          conversation_id: string
          last_created_at: string
          last_message: string
          last_sender_id: string
          last_sender_name: string
          last_type: string
          peer_id: string
          peer_read_at: string
          title: string
          type: string
          unread: number
          updated_at: string
        }[]
      }
      get_my_profile_private: {
        Args: never
        Returns: {
          omiq_wallet_address: string
          oniq_pay_enabled: boolean
          upi_vpa: string
        }[]
      }
      is_admin: { Args: { _uid: string }; Returns: boolean }
      is_conversation_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      join_channel: { Args: { _conversation_id: string }; Returns: undefined }
      leave_group: { Args: { _conversation_id: string }; Returns: undefined }
      list_public_channels: {
        Args: { _limit?: number; _search?: string }
        Returns: {
          created_at: string
          description: string
          id: string
          name: string
          subscriber_count: number
        }[]
      }
      mark_conversation_read: {
        Args: { _conversation_id: string }
        Returns: undefined
      }
      mark_policy_notice_seen: { Args: never; Returns: undefined }
      open_red_packet: { Args: { _packet_id: string }; Returns: number }
      place_order: {
        Args: {
          _delivery_address: string
          _items: Json
          _restaurant_id: string
        }
        Returns: string
      }
      reclaim_red_packet: { Args: { _packet_id: string }; Returns: number }
      record_clip_view: { Args: { _clip_id: string }; Returns: undefined }
      remove_group_member: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: undefined
      }
      respond_friend_request: {
        Args: { _accept: boolean; _other: string }
        Returns: string
      }
      respond_payment_request: {
        Args: { _accept: boolean; _request_id: string }
        Returns: string
      }
      send_friend_request: { Args: { _to: string }; Returns: undefined }
      send_payment: {
        Args: { _amount: number; _note?: string; _recipient_username: string }
        Returns: string
      }
      send_red_packet: {
        Args: { _amount: number; _greeting?: string; _to_username: string }
        Returns: string
      }
      set_primary_bank: { Args: { _bank_id: string }; Returns: undefined }
      toggle_clip_like: { Args: { _clip_id: string }; Returns: boolean }
      toggle_moment_like: { Args: { _post_id: string }; Returns: boolean }
      unread_count: { Args: { _conversation_id: string }; Returns: number }
      withdraw_to_bank: {
        Args: { _amount: number; _bank_id: string }
        Returns: string
      }
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
