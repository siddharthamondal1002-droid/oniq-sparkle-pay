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
      api_budget: {
        Row: {
          bucket: string
          day: string
          used: number
        }
        Insert: {
          bucket: string
          day: string
          used?: number
        }
        Update: {
          bucket?: string
          day?: string
          used?: number
        }
        Relationships: []
      }
      assessment_competency: {
        Row: {
          bloom_level: string
          board: string
          chapter: string | null
          class_level: string
          command_word: string | null
          created_at: string
          dok_level: number
          id: string
          statement: string
          subject: string
        }
        Insert: {
          bloom_level: string
          board: string
          chapter?: string | null
          class_level: string
          command_word?: string | null
          created_at?: string
          dok_level: number
          id?: string
          statement: string
          subject: string
        }
        Update: {
          bloom_level?: string
          board?: string
          chapter?: string | null
          class_level?: string
          command_word?: string | null
          created_at?: string
          dok_level?: number
          id?: string
          statement?: string
          subject?: string
        }
        Relationships: []
      }
      assessment_item: {
        Row: {
          created_at: string
          id: string
          key: string
          key_verified_by: string | null
          options: Json | null
          provenance: Json
          quarantine_reason: string | null
          similarity_matched_against: string | null
          similarity_score: number | null
          status: Database["public"]["Enums"]["assessment_item_status"]
          stem: string
          task_model_id: string
          verified_at: string | null
          verified_by_user: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          key_verified_by?: string | null
          options?: Json | null
          provenance?: Json
          quarantine_reason?: string | null
          similarity_matched_against?: string | null
          similarity_score?: number | null
          status?: Database["public"]["Enums"]["assessment_item_status"]
          stem: string
          task_model_id: string
          verified_at?: string | null
          verified_by_user?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          key_verified_by?: string | null
          options?: Json | null
          provenance?: Json
          quarantine_reason?: string | null
          similarity_matched_against?: string | null
          similarity_score?: number | null
          status?: Database["public"]["Enums"]["assessment_item_status"]
          stem?: string
          task_model_id?: string
          verified_at?: string | null
          verified_by_user?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_item_task_model_id_fkey"
            columns: ["task_model_id"]
            isOneToOne: false
            referencedRelation: "assessment_task_model"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_response: {
        Row: {
          answer: string | null
          answered_at: string
          confidence: number | null
          correct: boolean | null
          id: string
          item_id: string
          user_id: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string
          confidence?: number | null
          correct?: boolean | null
          id?: string
          item_id: string
          user_id: string
        }
        Update: {
          answer?: string | null
          answered_at?: string
          confidence?: number | null
          correct?: boolean | null
          id?: string
          item_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_response_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "assessment_item"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_task_model: {
        Row: {
          competency_id: string
          created_at: string
          difficulty_target: number | null
          distractor_rules: Json
          format: string
          id: string
          key_derivation: string
          marks: number
          slots: Json
          stem_template: string
        }
        Insert: {
          competency_id: string
          created_at?: string
          difficulty_target?: number | null
          distractor_rules?: Json
          format: string
          id?: string
          key_derivation: string
          marks: number
          slots?: Json
          stem_template: string
        }
        Update: {
          competency_id?: string
          created_at?: string
          difficulty_target?: number | null
          distractor_rules?: Json
          format?: string
          id?: string
          key_derivation?: string
          marks?: number
          slots?: Json
          stem_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_task_model_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "assessment_competency"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          actor: string
          created_at: string
          event_data: Json
          event_type: string
          id: string
          prev_hash: string | null
          record_hash: string
          seq: number
          user_id: string | null
        }
        Insert: {
          actor?: string
          created_at?: string
          event_data?: Json
          event_type: string
          id?: string
          prev_hash?: string | null
          record_hash?: string
          seq?: number
          user_id?: string | null
        }
        Update: {
          actor?: string
          created_at?: string
          event_data?: Json
          event_type?: string
          id?: string
          prev_hash?: string | null
          record_hash?: string
          seq?: number
          user_id?: string | null
        }
        Relationships: []
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
      call_logs: {
        Row: {
          call_type: string
          callee_ids: string[]
          caller_id: string
          conversation_id: string
          created_at: string
          duration_s: number | null
          id: string
          started_at: string
          status: string
        }
        Insert: {
          call_type: string
          callee_ids?: string[]
          caller_id: string
          conversation_id: string
          created_at?: string
          duration_s?: number | null
          id?: string
          started_at?: string
          status: string
        }
        Update: {
          call_type?: string
          callee_ids?: string[]
          caller_id?: string
          conversation_id?: string
          created_at?: string
          duration_s?: number | null
          id?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      call_reminders: {
        Row: {
          conversation_id: string
          created_at: string
          dismissed_at: string | null
          id: string
          peer_name: string | null
          remind_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          peer_name?: string | null
          remind_at: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          peer_name?: string | null
          remind_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_reminders_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_monetize_config: {
        Row: {
          id: boolean
          min_channel_age_days: number
          min_members: number
          min_posts: number
          min_total_views: number
          min_videos: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          min_channel_age_days?: number
          min_members?: number
          min_posts?: number
          min_total_views?: number
          min_videos?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          min_channel_age_days?: number
          min_members?: number
          min_posts?: number
          min_total_views?: number
          min_videos?: number
          updated_at?: string
        }
        Relationships: []
      }
      chapter_notes: {
        Row: {
          board: string
          chapter: string
          class_level: string
          content: string
          created_at: string
          id: string
          source_note: string
          subject: string
        }
        Insert: {
          board: string
          chapter: string
          class_level: string
          content: string
          created_at?: string
          id?: string
          source_note?: string
          subject: string
        }
        Update: {
          board?: string
          chapter?: string
          class_level?: string
          content?: string
          created_at?: string
          id?: string
          source_note?: string
          subject?: string
        }
        Relationships: []
      }
      chapter_overrides: {
        Row: {
          chapter_number: number
          chapter_title: string
          created_at: string
          id: string
          learner_profile_id: string
          subject: string
          updated_at: string
        }
        Insert: {
          chapter_number: number
          chapter_title: string
          created_at?: string
          id?: string
          learner_profile_id: string
          subject: string
          updated_at?: string
        }
        Update: {
          chapter_number?: number
          chapter_title?: string
          created_at?: string
          id?: string
          learner_profile_id?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chapter_overrides_learner_profile_id_fkey"
            columns: ["learner_profile_id"]
            isOneToOne: false
            referencedRelation: "learner_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chapters: {
        Row: {
          board: string
          chapter_number: number
          chapter_title: string
          class_level: string
          created_at: string
          id: string
          source_note: string
          subject: string
        }
        Insert: {
          board: string
          chapter_number: number
          chapter_title: string
          class_level: string
          created_at?: string
          id?: string
          source_note?: string
          subject: string
        }
        Update: {
          board?: string
          chapter_number?: number
          chapter_title?: string
          class_level?: string
          created_at?: string
          id?: string
          source_note?: string
          subject?: string
        }
        Relationships: []
      }
      client_error_reports: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          message: string
          surface: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          message: string
          surface: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          message?: string
          surface?: string
          user_id?: string | null
        }
        Relationships: []
      }
      clips: {
        Row: {
          caption: string | null
          comment_count: number
          created_at: string | null
          hashtags: string[] | null
          id: string
          is_deleted: boolean
          is_synthetic: boolean
          like_count: number
          thumbnail_url: string | null
          user_id: string
          video_url: string
          view_count: number
          visibility: string
        }
        Insert: {
          caption?: string | null
          comment_count?: number
          created_at?: string | null
          hashtags?: string[] | null
          id?: string
          is_deleted?: boolean
          is_synthetic?: boolean
          like_count?: number
          thumbnail_url?: string | null
          user_id: string
          video_url: string
          view_count?: number
          visibility?: string
        }
        Update: {
          caption?: string | null
          comment_count?: number
          created_at?: string | null
          hashtags?: string[] | null
          id?: string
          is_deleted?: boolean
          is_synthetic?: boolean
          like_count?: number
          thumbnail_url?: string | null
          user_id?: string
          video_url?: string
          view_count?: number
          visibility?: string
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
      consent_records: {
        Row: {
          consent_state: string
          created_at: string
          data_categories: Json
          id: string
          jurisdiction: string
          notice_locale: string
          notice_version: string
          prev_hash: string | null
          purpose_desc: string
          purpose_id: string
          record_hash: string
          schema_version: string
          seq: number
          user_id: string
        }
        Insert: {
          consent_state: string
          created_at?: string
          data_categories: Json
          id?: string
          jurisdiction: string
          notice_locale: string
          notice_version: string
          prev_hash?: string | null
          purpose_desc: string
          purpose_id: string
          record_hash?: string
          schema_version?: string
          seq?: number
          user_id: string
        }
        Update: {
          consent_state?: string
          created_at?: string
          data_categories?: Json
          id?: string
          jurisdiction?: string
          notice_locale?: string
          notice_version?: string
          prev_hash?: string | null
          purpose_desc?: string
          purpose_id?: string
          record_hash?: string
          schema_version?: string
          seq?: number
          user_id?: string
        }
        Relationships: []
      }
      content_views: {
        Row: {
          channel_id: string
          message_id: string
          viewed_on: string
          viewer_id: string
        }
        Insert: {
          channel_id: string
          message_id: string
          viewed_on?: string
          viewer_id: string
        }
        Update: {
          channel_id?: string
          message_id?: string
          viewed_on?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_views_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_views_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          cleared_at: string | null
          conversation_id: string
          id: string
          joined_at: string | null
          last_read_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          cleared_at?: string | null
          conversation_id: string
          id?: string
          joined_at?: string | null
          last_read_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          cleared_at?: string | null
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
      copyright_notices: {
        Row: {
          actioned_at: string | null
          complainant_email: string
          complainant_name: string
          complainant_org: string | null
          counts_as_strike: boolean
          id: string
          notes: string | null
          notice_kind: string
          purge_after: string | null
          received_at: string
          respondent_id: string | null
          status: string
          sworn_statement: boolean
          target_row_id: string | null
          target_table: string | null
          target_url: string | null
          work_described: string
        }
        Insert: {
          actioned_at?: string | null
          complainant_email: string
          complainant_name: string
          complainant_org?: string | null
          counts_as_strike?: boolean
          id?: string
          notes?: string | null
          notice_kind?: string
          purge_after?: string | null
          received_at?: string
          respondent_id?: string | null
          status?: string
          sworn_statement?: boolean
          target_row_id?: string | null
          target_table?: string | null
          target_url?: string | null
          work_described: string
        }
        Update: {
          actioned_at?: string | null
          complainant_email?: string
          complainant_name?: string
          complainant_org?: string | null
          counts_as_strike?: boolean
          id?: string
          notes?: string | null
          notice_kind?: string
          purge_after?: string | null
          received_at?: string
          respondent_id?: string | null
          status?: string
          sworn_statement?: boolean
          target_row_id?: string | null
          target_table?: string | null
          target_url?: string | null
          work_described?: string
        }
        Relationships: []
      }
      creator_payout_runs: {
        Row: {
          channels: number
          distributed_paise: number
          id: string
          pool_paise: number
          ran_at: string
        }
        Insert: {
          channels?: number
          distributed_paise?: number
          id?: string
          pool_paise: number
          ran_at?: string
        }
        Update: {
          channels?: number
          distributed_paise?: number
          id?: string
          pool_paise?: number
          ran_at?: string
        }
        Relationships: []
      }
      creator_payouts: {
        Row: {
          allocation_paise: number
          channel_id: string
          created_at: string
          creator_id: string
          creator_paise: number
          engagement_points: number
          id: string
          oniq_paise: number
          run_id: string
          subscriber_count: number
          subscriber_paise: number
        }
        Insert: {
          allocation_paise: number
          channel_id: string
          created_at?: string
          creator_id: string
          creator_paise: number
          engagement_points: number
          id?: string
          oniq_paise: number
          run_id: string
          subscriber_count: number
          subscriber_paise: number
        }
        Update: {
          allocation_paise?: number
          channel_id?: string
          created_at?: string
          creator_id?: string
          creator_paise?: number
          engagement_points?: number
          id?: string
          oniq_paise?: number
          run_id?: string
          subscriber_count?: number
          subscriber_paise?: number
        }
        Relationships: [
          {
            foreignKeyName: "creator_payouts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_payouts_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_payouts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "creator_payout_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_program_config: {
        Row: {
          creator_pct: number
          enabled: boolean
          id: boolean
          oniq_pct: number
          period_pool_paise: number
          sub_min_member_days: number
          sub_min_watched_videos: number
          subscriber_pct: number
          updated_at: string
        }
        Insert: {
          creator_pct?: number
          enabled?: boolean
          id?: boolean
          oniq_pct?: number
          period_pool_paise?: number
          sub_min_member_days?: number
          sub_min_watched_videos?: number
          subscriber_pct?: number
          updated_at?: string
        }
        Update: {
          creator_pct?: number
          enabled?: boolean
          id?: boolean
          oniq_pct?: number
          period_pool_paise?: number
          sub_min_member_days?: number
          sub_min_watched_videos?: number
          subscriber_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      cv_attestations: {
        Row: {
          attested_at: string
          cv_id: string
          id: string
          statement: string
          user_id: string
        }
        Insert: {
          attested_at?: string
          cv_id: string
          id?: string
          statement: string
          user_id: string
        }
        Update: {
          attested_at?: string
          cv_id?: string
          id?: string
          statement?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_attestations_cv_id_fkey"
            columns: ["cv_id"]
            isOneToOne: false
            referencedRelation: "cv_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_documents: {
        Row: {
          content: Json
          created_at: string
          id: string
          target_country: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: Json
          created_at?: string
          id?: string
          target_country?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          target_country?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cycle_logs: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          period_end: string | null
          period_start: string
          symptoms: string[] | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          period_end?: string | null
          period_start: string
          symptoms?: string[] | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string
          symptoms?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_proofs: {
        Row: {
          buckets_checked: number
          created_at: string
          id: string
          pass: boolean
          report_sha256: string
          residues: Json
          run_by: string
          tables_checked: number
          test_email: string
          test_uid: string
        }
        Insert: {
          buckets_checked: number
          created_at?: string
          id?: string
          pass: boolean
          report_sha256: string
          residues?: Json
          run_by: string
          tables_checked: number
          test_email: string
          test_uid: string
        }
        Update: {
          buckets_checked?: number
          created_at?: string
          id?: string
          pass?: boolean
          report_sha256?: string
          residues?: Json
          run_by?: string
          tables_checked?: number
          test_email?: string
          test_uid?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dob_change_events: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      dsr_requests: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          details: string | null
          erasure_effective_at: string | null
          grace_expires_at: string | null
          id: string
          purged_at: string | null
          request_type: string
          sla_deadline: string | null
          soft_deleted_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          details?: string | null
          erasure_effective_at?: string | null
          grace_expires_at?: string | null
          id?: string
          purged_at?: string | null
          request_type: string
          sla_deadline?: string | null
          soft_deleted_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          details?: string | null
          erasure_effective_at?: string | null
          grace_expires_at?: string | null
          id?: string
          purged_at?: string | null
          request_type?: string
          sla_deadline?: string | null
          soft_deleted_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      episode_jobs: {
        Row: {
          created_at: string
          created_by: string
          error: string | null
          finished_at: string | null
          id: string
          notes: Json | null
          started_at: string | null
          status: string
          stored_path: string | null
          timeline: Json
          title: string | null
          total_seconds: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          error?: string | null
          finished_at?: string | null
          id?: string
          notes?: Json | null
          started_at?: string | null
          status?: string
          stored_path?: string | null
          timeline: Json
          title?: string | null
          total_seconds: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          notes?: Json | null
          started_at?: string | null
          status?: string
          stored_path?: string | null
          timeline?: Json
          title?: string | null
          total_seconds?: number
          updated_at?: string
        }
        Relationships: []
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
      grievances: {
        Row: {
          acknowledge_due_at: string | null
          acknowledged_at: string | null
          complaint_type: string
          created_at: string
          email: string
          id: string
          message: string
          name: string
          resolve_due_at: string | null
          resolved_at: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          acknowledge_due_at?: string | null
          acknowledged_at?: string | null
          complaint_type: string
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          resolve_due_at?: string | null
          resolved_at?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          acknowledge_due_at?: string | null
          acknowledged_at?: string | null
          complaint_type?: string
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          resolve_due_at?: string | null
          resolved_at?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      health_checkins: {
        Row: {
          created_at: string
          day: string
          energy: number | null
          exercised: boolean | null
          id: string
          mood: number | null
          sleep_hrs: number | null
          user_id: string
          water_glasses: number | null
        }
        Insert: {
          created_at?: string
          day?: string
          energy?: number | null
          exercised?: boolean | null
          id?: string
          mood?: number | null
          sleep_hrs?: number | null
          user_id: string
          water_glasses?: number | null
        }
        Update: {
          created_at?: string
          day?: string
          energy?: number | null
          exercised?: boolean | null
          id?: string
          mood?: number | null
          sleep_hrs?: number | null
          user_id?: string
          water_glasses?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "health_checkins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      health_profiles: {
        Row: {
          created_at: string
          experience: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          experience: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          experience?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      learner_profiles: {
        Row: {
          board: string
          class_level: string
          created_at: string
          edu_region: string | null
          edu_stage: string | null
          edu_system_id: string | null
          id: string
          name: string
          second_language: string | null
          user_id: string
        }
        Insert: {
          board: string
          class_level: string
          created_at?: string
          edu_region?: string | null
          edu_stage?: string | null
          edu_system_id?: string | null
          id?: string
          name: string
          second_language?: string | null
          user_id?: string
        }
        Update: {
          board?: string
          class_level?: string
          created_at?: string
          edu_region?: string | null
          edu_stage?: string | null
          edu_system_id?: string | null
          id?: string
          name?: string
          second_language?: string | null
          user_id?: string
        }
        Relationships: []
      }
      legal_holds: {
        Row: {
          active: boolean
          created_at: string
          expires_at: string
          id: string
          legal_request_id: string | null
          override_reason: string
          released_at: string | null
          scope: string
          subject_user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          expires_at: string
          id?: string
          legal_request_id?: string | null
          override_reason: string
          released_at?: string | null
          scope?: string
          subject_user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          legal_request_id?: string | null
          override_reason?: string
          released_at?: string | null
          scope?: string
          subject_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_holds_legal_request_id_fkey"
            columns: ["legal_request_id"]
            isOneToOne: false
            referencedRelation: "legal_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_requests: {
        Row: {
          approver_1: string | null
          approver_1_at: string | null
          approver_2: string | null
          approver_2_at: string | null
          created_at: string
          flag_reason: string | null
          fulfilled_at: string | null
          id: string
          issuer_kind: string
          issuer_name: string | null
          notes: string | null
          order_ref: string | null
          received_at: string
          records_sought: string
          status: string
          target_identifier: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          approver_1?: string | null
          approver_1_at?: string | null
          approver_2?: string | null
          approver_2_at?: string | null
          created_at?: string
          flag_reason?: string | null
          fulfilled_at?: string | null
          id?: string
          issuer_kind: string
          issuer_name?: string | null
          notes?: string | null
          order_ref?: string | null
          received_at?: string
          records_sought: string
          status?: string
          target_identifier: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          approver_1?: string | null
          approver_1_at?: string | null
          approver_2?: string | null
          approver_2_at?: string | null
          created_at?: string
          flag_reason?: string | null
          fulfilled_at?: string | null
          id?: string
          issuer_kind?: string
          issuer_name?: string | null
          notes?: string | null
          order_ref?: string | null
          received_at?: string
          records_sought?: string
          status?: string
          target_identifier?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      media_provenance: {
        Row: {
          confidence: string | null
          content_id: string | null
          content_type: string
          created_at: string
          declared_synthetic: boolean
          evidence: Json | null
          id: string
          origin: string
          sha256: string
          uploader_id: string
        }
        Insert: {
          confidence?: string | null
          content_id?: string | null
          content_type: string
          created_at?: string
          declared_synthetic?: boolean
          evidence?: Json | null
          id?: string
          origin?: string
          sha256: string
          uploader_id: string
        }
        Update: {
          confidence?: string | null
          content_id?: string | null
          content_type?: string
          created_at?: string
          declared_synthetic?: boolean
          evidence?: Json | null
          id?: string
          origin?: string
          sha256?: string
          uploader_id?: string
        }
        Relationships: []
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
      message_hides: {
        Row: {
          conversation_id: string | null
          created_at: string
          message_id: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          message_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_hides_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_translations: {
        Row: {
          created_at: string
          engine: string
          message_id: string
          source_lang: string | null
          target_lang: string
          translated_text: string
        }
        Insert: {
          created_at?: string
          engine: string
          message_id: string
          source_lang?: string | null
          target_lang: string
          translated_text: string
        }
        Update: {
          created_at?: string
          engine?: string
          message_id?: string
          source_lang?: string | null
          target_lang?: string
          translated_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_translations_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
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
          edited_at: string | null
          file_name: string | null
          file_size: number | null
          id: string
          is_ai: boolean
          is_deleted: boolean | null
          media_url: string | null
          metadata: Json | null
          reply_to_id: string | null
          sender_id: string
          starred_by: string[]
          type: string
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string | null
          duration_s?: number | null
          edited_at?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          is_ai?: boolean
          is_deleted?: boolean | null
          media_url?: string | null
          metadata?: Json | null
          reply_to_id?: string | null
          sender_id: string
          starred_by?: string[]
          type?: string
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string | null
          duration_s?: number | null
          edited_at?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          is_ai?: boolean
          is_deleted?: boolean | null
          media_url?: string | null
          metadata?: Json | null
          reply_to_id?: string | null
          sender_id?: string
          starred_by?: string[]
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
          is_deleted: boolean
          is_synthetic: boolean
          like_count: number | null
          location_name: string | null
          media_urls: string[] | null
          user_id: string
          view_count: number
          visibility: string
        }
        Insert: {
          comment_count?: number | null
          content?: string | null
          created_at?: string | null
          id?: string
          is_deleted?: boolean
          is_synthetic?: boolean
          like_count?: number | null
          location_name?: string | null
          media_urls?: string[] | null
          user_id: string
          view_count?: number
          visibility?: string
        }
        Update: {
          comment_count?: number | null
          content?: string | null
          created_at?: string | null
          id?: string
          is_deleted?: boolean
          is_synthetic?: boolean
          like_count?: number | null
          location_name?: string | null
          media_urls?: string[] | null
          user_id?: string
          view_count?: number
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
      otp_attempts: {
        Row: {
          created_at: string
          expires_at: string
          otp: string
          phone: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          otp: string
          phone: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          otp?: string
          phone?: string
        }
        Relationships: []
      }
      parental_consent_requests: {
        Row: {
          child_user_id: string
          code: string
          created_at: string
          expires_at: string
          failure_reason: string | null
          id: string
          method: string
          parent_email: string | null
          status: string
          token_ref: string | null
          verified_at: string | null
          verifier_user_id: string | null
        }
        Insert: {
          child_user_id: string
          code: string
          created_at?: string
          expires_at?: string
          failure_reason?: string | null
          id?: string
          method: string
          parent_email?: string | null
          status?: string
          token_ref?: string | null
          verified_at?: string | null
          verifier_user_id?: string | null
        }
        Update: {
          child_user_id?: string
          code?: string
          created_at?: string
          expires_at?: string
          failure_reason?: string | null
          id?: string
          method?: string
          parent_email?: string | null
          status?: string
          token_ref?: string | null
          verified_at?: string | null
          verifier_user_id?: string | null
        }
        Relationships: []
      }
      partner_applications: {
        Row: {
          aadhaar_path: string | null
          area: string | null
          availability: string[]
          city: string
          created_at: string
          experience_years: number
          extra_doc_path: string | null
          full_name: string
          id: string
          note: string | null
          pan_path: string | null
          phone: string
          region: string | null
          skills: string[]
          status: string
          user_id: string | null
          verification_status: string
          village: string | null
        }
        Insert: {
          aadhaar_path?: string | null
          area?: string | null
          availability?: string[]
          city: string
          created_at?: string
          experience_years?: number
          extra_doc_path?: string | null
          full_name: string
          id?: string
          note?: string | null
          pan_path?: string | null
          phone: string
          region?: string | null
          skills?: string[]
          status?: string
          user_id?: string | null
          verification_status?: string
          village?: string | null
        }
        Update: {
          aadhaar_path?: string | null
          area?: string | null
          availability?: string[]
          city?: string
          created_at?: string
          experience_years?: number
          extra_doc_path?: string | null
          full_name?: string
          id?: string
          note?: string | null
          pan_path?: string | null
          phone?: string
          region?: string | null
          skills?: string[]
          status?: string
          user_id?: string | null
          verification_status?: string
          village?: string | null
        }
        Relationships: []
      }
      payment_config: {
        Row: {
          currency: string
          enabled: boolean
          id: boolean
          max_amount_minor: number
          min_amount_minor: number
          updated_at: string
        }
        Insert: {
          currency?: string
          enabled?: boolean
          id?: boolean
          max_amount_minor?: number
          min_amount_minor?: number
          updated_at?: string
        }
        Update: {
          currency?: string
          enabled?: boolean
          id?: boolean
          max_amount_minor?: number
          min_amount_minor?: number
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_minor: number
          confirmed_by: string | null
          created_at: string
          currency: string
          error: string | null
          id: string
          order_id: string
          provider: string
          provider_order_id: string
          provider_payment_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          confirmed_by?: string | null
          created_at?: string
          currency?: string
          error?: string | null
          id?: string
          order_id: string
          provider?: string
          provider_order_id: string
          provider_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          confirmed_by?: string | null
          created_at?: string
          currency?: string
          error?: string | null
          id?: string
          order_id?: string
          provider?: string
          provider_order_id?: string
          provider_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_methods: {
        Row: {
          updated_at: string
          user_id: string
          vpa: string
        }
        Insert: {
          updated_at?: string
          user_id: string
          vpa: string
        }
        Update: {
          updated_at?: string
          user_id?: string
          vpa?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_methods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_queue: {
        Row: {
          amount_paise: number
          channel_id: string
          created_at: string
          error: string | null
          id: string
          kind: string
          provider_payout_id: string | null
          recipient_id: string
          run_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_paise: number
          channel_id: string
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          provider_payout_id?: string | null
          recipient_id: string
          run_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_paise?: number
          channel_id?: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          provider_payout_id?: string | null
          recipient_id?: string
          run_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_queue_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_queue_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_queue_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "creator_payout_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      post_views: {
        Row: {
          first_viewed_at: string
          last_viewed_at: string
          post_id: string
          post_type: string
          viewer_id: string
        }
        Insert: {
          first_viewed_at?: string
          last_viewed_at?: string
          post_id: string
          post_type: string
          viewer_id: string
        }
        Update: {
          first_viewed_at?: string
          last_viewed_at?: string
          post_id?: string
          post_type?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_qr_tokens: {
        Row: {
          created_at: string
          rotated_at: string | null
          rotation_count: number
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          rotated_at?: string | null
          rotation_count?: number
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          rotated_at?: string | null
          rotation_count?: number
          token?: string
          user_id?: string
        }
        Relationships: []
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
          oniq_pay_enabled: boolean | null
          show_view_identity: boolean
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
          is_admin?: boolean
          language?: string | null
          last_policy_notice_at?: string | null
          oniq_pay_enabled?: boolean | null
          show_view_identity?: boolean
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
          is_admin?: boolean
          language?: string | null
          last_policy_notice_at?: string | null
          oniq_pay_enabled?: boolean | null
          show_view_identity?: boolean
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      profiles_private: {
        Row: {
          date_of_birth: string | null
          is_minor: boolean
          parent_email: string | null
          parent_name: string | null
          parent_phone: string | null
          updated_at: string
          upi_vpa: string | null
          user_id: string
        }
        Insert: {
          date_of_birth?: string | null
          is_minor?: boolean
          parent_email?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          updated_at?: string
          upi_vpa?: string | null
          user_id: string
        }
        Update: {
          date_of_birth?: string | null
          is_minor?: boolean
          parent_email?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          updated_at?: string
          upi_vpa?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_private_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempts: {
        Row: {
          answer_sheet: Json | null
          chapter: string | null
          correct_count: number | null
          created_at: string
          id: string
          marks_scored: number | null
          profile_id: string
          subject: string
          topic: string
          total_marks: number | null
          total_questions: number | null
        }
        Insert: {
          answer_sheet?: Json | null
          chapter?: string | null
          correct_count?: number | null
          created_at?: string
          id?: string
          marks_scored?: number | null
          profile_id: string
          subject: string
          topic: string
          total_marks?: number | null
          total_questions?: number | null
        }
        Update: {
          answer_sheet?: Json | null
          chapter?: string | null
          correct_count?: number | null
          created_at?: string
          id?: string
          marks_scored?: number | null
          profile_id?: string
          subject?: string
          topic?: string
          total_marks?: number | null
          total_questions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "learner_profiles"
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
      security_incidents: {
        Row: {
          affected_count: number | null
          aware_at: string
          cert_in_deadline: string | null
          cert_in_reported_at: string | null
          created_at: string
          dpb_intimated_at: string | null
          dpb_report_deadline: string | null
          dpb_reported_at: string | null
          id: string
          kind: string
          notes: string | null
          severity: string
          status: string
          summary: string
          user_notified_at: string | null
        }
        Insert: {
          affected_count?: number | null
          aware_at?: string
          cert_in_deadline?: string | null
          cert_in_reported_at?: string | null
          created_at?: string
          dpb_intimated_at?: string | null
          dpb_report_deadline?: string | null
          dpb_reported_at?: string | null
          id?: string
          kind: string
          notes?: string | null
          severity: string
          status?: string
          summary: string
          user_notified_at?: string | null
        }
        Update: {
          affected_count?: number | null
          aware_at?: string
          cert_in_deadline?: string | null
          cert_in_reported_at?: string | null
          created_at?: string
          dpb_intimated_at?: string | null
          dpb_report_deadline?: string | null
          dpb_reported_at?: string | null
          id?: string
          kind?: string
          notes?: string | null
          severity?: string
          status?: string
          summary?: string
          user_notified_at?: string | null
        }
        Relationships: []
      }
      service_bookings: {
        Row: {
          address: string | null
          agreed_price: number | null
          application_id: string
          category: string | null
          counter_price: number | null
          created_at: string
          customer_id: string
          id: string
          note: string | null
          offered_price: number | null
          rated_at: string | null
          rating: number | null
          region: string
          review: string | null
          scheduled_date: string | null
          status: string
          time_slot: string | null
        }
        Insert: {
          address?: string | null
          agreed_price?: number | null
          application_id: string
          category?: string | null
          counter_price?: number | null
          created_at?: string
          customer_id: string
          id?: string
          note?: string | null
          offered_price?: number | null
          rated_at?: string | null
          rating?: number | null
          region: string
          review?: string | null
          scheduled_date?: string | null
          status?: string
          time_slot?: string | null
        }
        Update: {
          address?: string | null
          agreed_price?: number | null
          application_id?: string
          category?: string | null
          counter_price?: number | null
          created_at?: string
          customer_id?: string
          id?: string
          note?: string | null
          offered_price?: number | null
          rated_at?: string | null
          rating?: number | null
          region?: string
          review?: string | null
          scheduled_date?: string | null
          status?: string
          time_slot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_bookings_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      status_updates: {
        Row: {
          bg_color: string | null
          content: string | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          media_url: string | null
          user_id: string
          view_count: number
        }
        Insert: {
          bg_color?: string | null
          content?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          media_url?: string | null
          user_id: string
          view_count?: number
        }
        Update: {
          bg_color?: string | null
          content?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          media_url?: string | null
          user_id?: string
          view_count?: number
        }
        Relationships: []
      }
      status_views: {
        Row: {
          status_id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          status_id: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          status_id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_views_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "status_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      story_addons: {
        Row: {
          active: boolean
          key: string
          label: string
          price_paise: number
        }
        Insert: {
          active?: boolean
          key: string
          label: string
          price_paise: number
        }
        Update: {
          active?: boolean
          key?: string
          label?: string
          price_paise?: number
        }
        Relationships: []
      }
      story_allowance: {
        Row: {
          daily_day: string
          daily_used_seconds: number
          free_seconds: number | null
          paid_seconds: number
          updated_at: string
          used_seconds: number
          user_id: string
        }
        Insert: {
          daily_day?: string
          daily_used_seconds?: number
          free_seconds?: number | null
          paid_seconds?: number
          updated_at?: string
          used_seconds?: number
          user_id: string
        }
        Update: {
          daily_day?: string
          daily_used_seconds?: number
          free_seconds?: number | null
          paid_seconds?: number
          updated_at?: string
          used_seconds?: number
          user_id?: string
        }
        Relationships: []
      }
      story_config: {
        Row: {
          daily_seconds: number
          enabled: boolean
          free_seconds: number
          global_daily_seconds: number
          id: boolean
          max_story_seconds: number
          min_story_seconds: number
          updated_at: string
        }
        Insert: {
          daily_seconds?: number
          enabled?: boolean
          free_seconds?: number
          global_daily_seconds?: number
          id?: boolean
          max_story_seconds?: number
          min_story_seconds?: number
          updated_at?: string
        }
        Update: {
          daily_seconds?: number
          enabled?: boolean
          free_seconds?: number
          global_daily_seconds?: number
          id?: boolean
          max_story_seconds?: number
          min_story_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      story_global_usage: {
        Row: {
          day: string
          paid_seconds: number
          updated_at: string
          used_seconds: number
        }
        Insert: {
          day: string
          paid_seconds?: number
          updated_at?: string
          used_seconds?: number
        }
        Update: {
          day?: string
          paid_seconds?: number
          updated_at?: string
          used_seconds?: number
        }
        Relationships: []
      }
      story_jobs: {
        Row: {
          cast_json: Json | null
          created_at: string
          dispatched_at: string | null
          error: string | null
          has_bytes: boolean
          id: string
          no_watermark: boolean
          paid_seconds_charged: number
          prompt: string
          refunded_at: string | null
          render_target: string | null
          requested_seconds: number
          seconds_charged: number
          shot_count: number | null
          status: string
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cast_json?: Json | null
          created_at?: string
          dispatched_at?: string | null
          error?: string | null
          has_bytes?: boolean
          id?: string
          no_watermark?: boolean
          paid_seconds_charged?: number
          prompt: string
          refunded_at?: string | null
          render_target?: string | null
          requested_seconds: number
          seconds_charged: number
          shot_count?: number | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cast_json?: Json | null
          created_at?: string
          dispatched_at?: string | null
          error?: string | null
          has_bytes?: boolean
          id?: string
          no_watermark?: boolean
          paid_seconds_charged?: number
          prompt?: string
          refunded_at?: string | null
          render_target?: string | null
          requested_seconds?: number
          seconds_charged?: number
          shot_count?: number | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      story_price_tiers: {
        Row: {
          active: boolean
          currency: string
          grade: string
          label: string
          price_paise: number
          seconds: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          currency?: string
          grade?: string
          label: string
          price_paise: number
          seconds: number
          sort_order: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          currency?: string
          grade?: string
          label?: string
          price_paise?: number
          seconds?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      story_purchase_config: {
        Row: {
          checkout_url: string
          enabled: boolean
          id: boolean
          native_link_out: boolean
          updated_at: string
        }
        Insert: {
          checkout_url?: string
          enabled?: boolean
          id?: boolean
          native_link_out?: boolean
          updated_at?: string
        }
        Update: {
          checkout_url?: string
          enabled?: boolean
          id?: boolean
          native_link_out?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      story_purchases: {
        Row: {
          created_at: string
          currency: string
          error: string | null
          grade: string
          id: string
          origin: string
          paid_at: string | null
          price_paise: number
          provider: string
          provider_order_id: string | null
          provider_payment_id: string | null
          seconds: number
          seconds_credited: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency: string
          error?: string | null
          grade?: string
          id?: string
          origin?: string
          paid_at?: string | null
          price_paise: number
          provider?: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          seconds: number
          seconds_credited?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          error?: string | null
          grade?: string
          id?: string
          origin?: string
          paid_at?: string | null
          price_paise?: number
          provider?: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          seconds?: number
          seconds_credited?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      study_chapters_debug: {
        Row: {
          blocks_snippet: string | null
          board: string | null
          class_level: string | null
          created_at: string
          http_reason: string | null
          id: string
          reason: string | null
          source: string | null
          stop_reason: string | null
          subject: string | null
        }
        Insert: {
          blocks_snippet?: string | null
          board?: string | null
          class_level?: string | null
          created_at?: string
          http_reason?: string | null
          id?: string
          reason?: string | null
          source?: string | null
          stop_reason?: string | null
          subject?: string | null
        }
        Update: {
          blocks_snippet?: string | null
          board?: string | null
          class_level?: string | null
          created_at?: string
          http_reason?: string | null
          id?: string
          reason?: string | null
          source?: string | null
          stop_reason?: string | null
          subject?: string | null
        }
        Relationships: []
      }
      study_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          profile_id: string
          role: string
          used_vault: boolean
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          profile_id: string
          role: string
          used_vault?: boolean
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          profile_id?: string
          role?: string
          used_vault?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "study_messages_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "learner_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      study_notes: {
        Row: {
          board: string
          chapter: string | null
          class_level: string
          content: string
          created_at: string
          id: string
          search: unknown
          source: string
          subject: string
          topic: string
        }
        Insert: {
          board: string
          chapter?: string | null
          class_level: string
          content: string
          created_at?: string
          id?: string
          search?: unknown
          source?: string
          subject: string
          topic: string
        }
        Update: {
          board?: string
          chapter?: string | null
          class_level?: string
          content?: string
          created_at?: string
          id?: string
          search?: unknown
          source?: string
          subject?: string
          topic?: string
        }
        Relationships: []
      }
      study_papers: {
        Row: {
          answer_sheet: Json | null
          created_at: string
          draft_answers: Json
          duration_seconds: number | null
          id: string
          kind: string
          marks_scored: number | null
          profile_id: string
          questions: Json
          started_at: string | null
          status: string
          subject: string
          total_marks: number
          updated_at: string
        }
        Insert: {
          answer_sheet?: Json | null
          created_at?: string
          draft_answers?: Json
          duration_seconds?: number | null
          id?: string
          kind?: string
          marks_scored?: number | null
          profile_id: string
          questions: Json
          started_at?: string | null
          status?: string
          subject: string
          total_marks: number
          updated_at?: string
        }
        Update: {
          answer_sheet?: Json | null
          created_at?: string
          draft_answers?: Json
          duration_seconds?: number | null
          id?: string
          kind?: string
          marks_scored?: number | null
          profile_id?: string
          questions?: Json
          started_at?: string | null
          status?: string
          subject?: string
          total_marks?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_papers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "learner_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      takedown_orders: {
        Row: {
          authority: string | null
          content_id: string
          content_type: string
          created_at: string
          handled_by: string | null
          id: string
          order_ref: string | null
          reason: string | null
          received_at: string
          removed_at: string | null
          sla_deadline: string | null
          source: string
          status: string
        }
        Insert: {
          authority?: string | null
          content_id: string
          content_type: string
          created_at?: string
          handled_by?: string | null
          id?: string
          order_ref?: string | null
          reason?: string | null
          received_at?: string
          removed_at?: string | null
          sla_deadline?: string | null
          source: string
          status?: string
        }
        Update: {
          authority?: string | null
          content_id?: string
          content_type?: string
          created_at?: string
          handled_by?: string | null
          id?: string
          order_ref?: string | null
          reason?: string | null
          received_at?: string
          removed_at?: string | null
          sla_deadline?: string | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      usage_signals: {
        Row: {
          city: string | null
          created_at: string
          dow: number
          hour: number
          hub: string
          id: string
          kind: string
          user_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          dow: number
          hour: number
          hub: string
          id?: string
          kind: string
          user_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          dow?: number
          hour?: number
          hub?: string
          id?: string
          kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_signals_user_id_fkey"
            columns: ["user_id"]
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
      user_consents: {
        Row: {
          granted: boolean
          id: string
          purpose: string
          recorded_at: string
          source: string | null
          user_id: string
        }
        Insert: {
          granted: boolean
          id?: string
          purpose: string
          recorded_at?: string
          source?: string | null
          user_id: string
        }
        Update: {
          granted?: boolean
          id?: string
          purpose?: string
          recorded_at?: string
          source?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_memory: {
        Row: {
          confirmed: boolean
          created_at: string
          id: string
          key: string
          source: string
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          confirmed?: boolean
          created_at?: string
          id?: string
          key: string
          source?: string
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          confirmed?: boolean
          created_at?: string
          id?: string
          key?: string
          source?: string
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_memory_user_id_fkey"
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
      user_watch_channels: {
        Row: {
          created_at: string
          genre_id: string
          id: string
          name: string
          position: number
          updated_at: string
          user_id: string
          youtube_url: string
        }
        Insert: {
          created_at?: string
          genre_id: string
          id?: string
          name: string
          position?: number
          updated_at?: string
          user_id: string
          youtube_url: string
        }
        Update: {
          created_at?: string
          genre_id?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
          youtube_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_watch_channels_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "user_watch_genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_watch_channels_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_watch_genres: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_watch_genres_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_gen_config: {
        Row: {
          daily_cap: number
          enabled: boolean
          episode_daily_cap: number
          episodes_enabled: boolean
          id: boolean
          updated_at: string
        }
        Insert: {
          daily_cap?: number
          enabled?: boolean
          episode_daily_cap?: number
          episodes_enabled?: boolean
          id?: boolean
          updated_at?: string
        }
        Update: {
          daily_cap?: number
          enabled?: boolean
          episode_daily_cap?: number
          episodes_enabled?: boolean
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      video_jobs: {
        Row: {
          created_at: string | null
          created_by: string
          credits_estimate: number | null
          duration: number
          error: string | null
          id: string
          model: string
          output_url: string | null
          prompt_image_url: string
          prompt_text: string
          ratio: string
          runway_task_id: string | null
          scene_ref: string | null
          seed: number | null
          status: string
          stored_path: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          credits_estimate?: number | null
          duration?: number
          error?: string | null
          id?: string
          model?: string
          output_url?: string | null
          prompt_image_url: string
          prompt_text: string
          ratio?: string
          runway_task_id?: string | null
          scene_ref?: string | null
          seed?: number | null
          status?: string
          stored_path?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          credits_estimate?: number | null
          duration?: number
          error?: string | null
          id?: string
          model?: string
          output_url?: string | null
          prompt_image_url?: string
          prompt_text?: string
          ratio?: string
          runway_task_id?: string | null
          scene_ref?: string | null
          seed?: number | null
          status?: string
          stored_path?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      watermark_purchases: {
        Row: {
          applied: boolean
          created_at: string
          currency: string
          error: string | null
          id: string
          job_id: string
          price_paise: number
          provider: string
          provider_order_id: string | null
          provider_payment_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied?: boolean
          created_at?: string
          currency?: string
          error?: string | null
          id?: string
          job_id: string
          price_paise: number
          provider?: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applied?: boolean
          created_at?: string
          currency?: string
          error?: string | null
          id?: string
          job_id?: string
          price_paise?: number
          provider?: string
          provider_order_id?: string | null
          provider_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watermark_purchases_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "story_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_booking_price: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      add_group_members: {
        Args: { _conversation_id: string; _member_ids: string[] }
        Returns: undefined
      }
      admin_list_partner_verifications: {
        Args: never
        Returns: {
          aadhaar_path: string
          city: string
          created_at: string
          extra_doc_path: string
          full_name: string
          id: string
          pan_path: string
          phone: string
          region: string
          skills: string[]
          user_id: string
          verification_status: string
          village: string
        }[]
      }
      admin_remove_content: {
        Args: { _note?: string; _target_id: string; _target_type: string }
        Returns: undefined
      }
      admin_set_partner_verification: {
        Args: { _application_id: string; _status: string }
        Returns: undefined
      }
      admin_takedown_content: {
        Args: { _content_id: string; _content_type: string; _reason?: string }
        Returns: undefined
      }
      api_budget_day: { Args: never; Returns: string }
      api_budget_left: {
        Args: { _bucket: string; _cap: number }
        Returns: number
      }
      append_audit: {
        Args: {
          _actor?: string
          _event_data?: Json
          _event_type: string
          _user_id?: string
        }
        Returns: string
      }
      approve_parental_consent: { Args: { _code: string }; Returns: Json }
      attach_story_purchase_order: {
        Args: { _provider_order_id: string; _purchase_id: string }
        Returns: Json
      }
      attach_watermark_purchase_order: {
        Args: { _provider_order_id: string; _purchase_id: string }
        Returns: undefined
      }
      book_service: {
        Args: {
          _address?: string
          _application_id: string
          _category?: string
          _note?: string
          _offered_price?: number
          _scheduled_date?: string
          _time_slot?: string
        }
        Returns: Json
      }
      breach_notify_board: {
        Args: { _incident_id: string; _reference: string }
        Returns: undefined
      }
      breach_notify_users: {
        Args: { _incident_id: string; _message: string }
        Returns: undefined
      }
      breach_record_awareness: {
        Args: { _affected?: string[]; _summary: string }
        Returns: string
      }
      breach_submit_report: {
        Args: { _incident_id: string; _report: string }
        Returns: undefined
      }
      can_read_message: { Args: { _message_id: string }; Returns: boolean }
      channel_monetize_status: { Args: { _channel_id: string }; Returns: Json }
      channel_views_series: {
        Args: { _channel_id: string; _days?: number }
        Returns: Json
      }
      child_restricted: { Args: { _uid: string }; Returns: boolean }
      claim_payout_batch: { Args: { _limit?: number }; Returns: Json[] }
      claim_story_seconds: {
        Args: { _grade?: string; _prompt: string; _requested_seconds: number }
        Returns: Json
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
          is_synthetic: boolean
          like_count: number
          thumbnail_url: string | null
          user_id: string
          video_url: string
          view_count: number
          visibility: string
        }[]
        SetofOptions: {
          from: "*"
          to: "clips"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clips_feed_chrono: {
        Args: { _limit?: number; _offset?: number }
        Returns: {
          caption: string | null
          comment_count: number
          created_at: string | null
          hashtags: string[] | null
          id: string
          is_deleted: boolean
          is_synthetic: boolean
          like_count: number
          thumbnail_url: string | null
          user_id: string
          video_url: string
          view_count: number
          visibility: string
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
      copyright_purge_expired: { Args: never; Returns: number }
      create_channel: {
        Args: { _description: string; _is_public: boolean; _name: string }
        Returns: string
      }
      create_group: {
        Args: { _member_ids: string[]; _name: string }
        Returns: string
      }
      create_story_purchase: {
        Args: { _grade?: string; _origin?: string; _seconds: number }
        Returns: Json
      }
      create_watermark_purchase: { Args: { _job_id: string }; Returns: Json }
      credit_story_purchase: {
        Args: {
          _confirmed_by?: string
          _provider_order_id: string
          _provider_payment_id?: string
        }
        Returns: Json
      }
      delete_chat: { Args: { _conversation_id: string }; Returns: undefined }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_my_account: { Args: never; Returns: undefined }
      dsr_hard_purge_due: { Args: never; Returns: number }
      dsr_promote_due_erasures: { Args: never; Returns: number }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      export_my_data: { Args: never; Returns: Json }
      fail_story_purchase: {
        Args: { _error: string; _provider_order_id: string }
        Returns: Json
      }
      fail_watermark_purchase: {
        Args: { _error?: string; _provider_order_id: string }
        Returns: undefined
      }
      find_or_create_direct_conversation: {
        Args: { other_user_id: string }
        Returns: string
      }
      gen_profile_qr_token: { Args: never; Returns: string }
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
      get_my_profile_meta: {
        Args: never
        Returns: {
          country_code: string
          is_admin: boolean
          language: string
          last_policy_notice_at: string
          oniq_pay_enabled: boolean
          show_view_identity: boolean
        }[]
      }
      get_my_profile_private: {
        Args: never
        Returns: {
          date_of_birth: string
          is_minor: boolean
          oniq_pay_enabled: boolean
          parent_email: string
          parent_name: string
          parent_phone: string
          upi_vpa: string
        }[]
      }
      get_region_status: {
        Args: { _region: string }
        Returns: {
          enabled: boolean
          provider_count: number
        }[]
      }
      grant_watermark_removal: { Args: { _job_id: string }; Returns: Json }
      has_active_legal_hold: { Args: { _user_id: string }; Returns: boolean }
      health_data_allowed: { Args: { _user_id: string }; Returns: boolean }
      health_request_region_ok: { Args: never; Returns: boolean }
      is_admin: { Args: { _uid: string }; Returns: boolean }
      is_adult_18: { Args: { _uid: string }; Returns: boolean }
      is_conversation_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      is_minor_account: { Args: { _uid: string }; Returns: boolean }
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
      list_region_providers: {
        Args: { _region: string }
        Returns: {
          area: string
          avg_rating: number
          experience_years: number
          full_name: string
          id: string
          jobs_done: number
          skills: string[]
          village: string
        }[]
      }
      log_moderation_action: {
        Args: {
          _action: string
          _reason?: string
          _target_id: string
          _target_type: string
        }
        Returns: undefined
      }
      log_parental_consent: {
        Args: { _child: string; _detail: Json; _method: string }
        Returns: undefined
      }
      mark_conversation_read: {
        Args: { _conversation_id: string }
        Returns: undefined
      }
      mark_order_paid: {
        Args: {
          _confirmed_by: string
          _provider_order_id: string
          _provider_payment_id: string
        }
        Returns: Json
      }
      mark_payment_failed: {
        Args: { _error: string; _provider_order_id: string }
        Returns: Json
      }
      mark_payout_result: {
        Args: {
          _error?: string
          _id: string
          _provider_payout_id?: string
          _status: string
        }
        Returns: undefined
      }
      mark_policy_notice_seen: { Args: never; Returns: undefined }
      match_contacts: {
        Args: { _phones: string[] }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          username: string
        }[]
      }
      minor_age_for_country: { Args: { _country: string }; Returns: number }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      my_age_gate_status: { Args: never; Returns: Json }
      my_partner_bookings: {
        Args: never
        Returns: {
          address: string
          agreed_price: number
          category: string
          counter_price: number
          created_at: string
          customer_id: string
          customer_name: string
          id: string
          note: string
          offered_price: number
          rating: number
          review: string
          scheduled_date: string
          status: string
          time_slot: string
        }[]
      }
      my_profile_qr_token: { Args: never; Returns: string }
      my_service_bookings: {
        Args: never
        Returns: {
          agreed_price: number
          category: string
          counter_price: number
          created_at: string
          id: string
          note: string
          offered_price: number
          provider_name: string
          provider_user_id: string
          rating: number
          scheduled_date: string
          status: string
          time_slot: string
        }[]
      }
      offer_booking_price: {
        Args: { _booking_id: string; _price: number }
        Returns: undefined
      }
      parental_consent_verified: { Args: { _uid: string }; Returns: boolean }
      personalisation_allowed: { Args: { _uid: string }; Returns: boolean }
      place_order: {
        Args: {
          _delivery_address: string
          _items: Json
          _restaurant_id: string
        }
        Returns: string
      }
      post_view_count: {
        Args: { _post_id: string; _post_type: string }
        Returns: number
      }
      post_viewers: {
        Args: {
          _limit?: number
          _offset?: number
          _post_id: string
          _post_type: string
        }
        Returns: {
          anonymous: boolean
          avatar_url: string
          display_name: string
          username: string
          viewed_at: string
          viewer_id: string
        }[]
      }
      profile_card_by_qr_token: {
        Args: { _token: string }
        Returns: {
          avatar_url: string
          bio: string
          display_name: string
          user_id: string
          username: string
        }[]
      }
      public_moment_card: {
        Args: { _post_id: string }
        Returns: {
          content: string
          display_name: string
          media_url: string
          username: string
        }[]
      }
      public_profile_card: {
        Args: { _user_id: string }
        Returns: {
          avatar_url: string
          bio: string
          display_name: string
          username: string
        }[]
      }
      public_reel_card: {
        Args: { _clip_id: string }
        Returns: {
          caption: string
          display_name: string
          thumbnail_url: string
          username: string
        }[]
      }
      purge_my_health_data: { Args: never; Returns: number }
      rate_booking: {
        Args: { _booking_id: string; _rating: number; _review?: string }
        Returns: undefined
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_api_use: {
        Args: { _amount: number; _bucket: string }
        Returns: undefined
      }
      record_channel_views: {
        Args: { _channel_id: string; _message_ids: string[] }
        Returns: number
      }
      record_clip_view: { Args: { _clip_id: string }; Returns: undefined }
      record_consent: {
        Args: {
          _categories?: Json
          _granted: boolean
          _notice_locale?: string
          _notice_version?: string
          _purpose: string
          _purpose_desc?: string
          _source?: string
        }
        Returns: undefined
      }
      record_post_view: {
        Args: { _post_id: string; _post_type: string }
        Returns: undefined
      }
      refund_story_seconds: { Args: { _job_id: string }; Returns: Json }
      remove_group_member: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: undefined
      }
      repeat_infringer_strikes: { Args: { _uid: string }; Returns: number }
      report_client_error: {
        Args: { _detail?: string; _message: string; _surface: string }
        Returns: undefined
      }
      request_parental_consent: {
        Args: { _method?: string; _parent_email: string }
        Returns: Json
      }
      respond_booking: {
        Args: { _booking_id: string; _status: string }
        Returns: undefined
      }
      respond_friend_request: {
        Args: { _accept: boolean; _other: string }
        Returns: string
      }
      rotate_profile_qr_token: { Args: never; Returns: string }
      run_creator_payouts: { Args: { _pool_paise?: number }; Returns: Json }
      send_friend_request: { Args: { _to: string }; Returns: undefined }
      set_payout_vpa: { Args: { _vpa: string }; Returns: Json }
      set_signup_profile: {
        Args: {
          _dob: string
          _parent_email?: string
          _parent_name?: string
          _parent_phone?: string
        }
        Returns: Json
      }
      set_story_cast: { Args: { _cast: Json; _job_id: string }; Returns: Json }
      settle_watermark_purchase: {
        Args: {
          _confirmed_by?: string
          _provider_order_id: string
          _provider_payment_id?: string
        }
        Returns: Json
      }
      share_reel_to_moots: {
        Args: { _clip_id: string; _note?: string; _recipient_ids: string[] }
        Returns: {
          recipient_id: string
          status: string
        }[]
      }
      storage_object_name: {
        Args: { bucket: string; url: string }
        Returns: string
      }
      story_dispatch_tick: { Args: never; Returns: undefined }
      story_quota_status: { Args: never; Returns: Json }
      story_sweep_tick: { Args: never; Returns: undefined }
      submit_digilocker_parental_consent: {
        Args: { _token_ref: string }
        Returns: Json
      }
      subscriber_earn_status: { Args: { _channel_id: string }; Returns: Json }
      toggle_clip_like: { Args: { _clip_id: string }; Returns: boolean }
      toggle_message_star: { Args: { _message_id: string }; Returns: boolean }
      toggle_moment_like: { Args: { _post_id: string }; Returns: boolean }
      unread_count: { Args: { _conversation_id: string }; Returns: number }
      user_exists: { Args: { _identifier: string }; Returns: boolean }
      verify_audit_chain: {
        Args: never
        Returns: {
          first_bad: string
          ok: boolean
          rows_checked: number
        }[]
      }
      verify_consent_chain: {
        Args: { _user_id?: string }
        Returns: {
          first_bad: string
          ok: boolean
          rows_checked: number
        }[]
      }
      viewer_views_series: { Args: { _days?: number }; Returns: Json }
      wipe_my_chat_media: { Args: never; Returns: number }
      wipe_my_clips: { Args: never; Returns: number }
      wipe_my_moments: { Args: never; Returns: number }
    }
    Enums: {
      assessment_item_status: "draft" | "quarantined" | "approved" | "retired"
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
    Enums: {
      assessment_item_status: ["draft", "quarantined", "approved", "retired"],
    },
  },
} as const
