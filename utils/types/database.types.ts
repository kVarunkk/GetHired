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
    PostgrestVersion: "12.2.3"
  }
  pgmq_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      archive: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      pop: {
        Args: { queue_name: string }
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "message_record"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      read: {
        Args: { n: number; queue_name: string; sleep_seconds: number }
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "message_record"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      send: {
        Args: { message: Json; queue_name: string; sleep_seconds?: number }
        Returns: number[]
      }
      send_batch: {
        Args: { messages: Json[]; queue_name: string; sleep_seconds?: number }
        Returns: number[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_memories: {
        Row: {
          category: string
          content: string
          created_at: string
          id: string
          source_session_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          content: string
          created_at?: string
          id?: string
          source_session_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          id?: string
          source_session_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_memories_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          created_at: string
          id: string
          metadata: Json | null
          parts: Json
          role: string
          seq: number
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id: string
          metadata?: Json | null
          parts: Json
          role: string
          seq?: never
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json | null
          parts?: Json
          role?: string
          seq?: never
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "agent_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_sessions: {
        Row: {
          created_at: string
          id: string
          role: string
          summary: string | null
          summary_upto_message_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          summary?: string | null
          summary_upto_message_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          summary?: string | null
          summary_upto_message_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      all_jobs: {
        Row: {
          ai_summary: string | null
          company_name: string | null
          company_url: string | null
          created_at: string
          description: string | null
          embedding_new: string | null
          embedding_updated_at: string | null
          equity_max: number | null
          equity_min: number | null
          equity_range: string | null
          experience: string | null
          experience_max: number | null
          experience_min: number
          id: string
          is_platform_job: boolean
          job_name: string | null
          job_type: Database["public"]["Enums"]["job_type_enum"]
          job_url: string | null
          locations: string[]
          normalized_locations: string[] | null
          platform: string | null
          salary_max: number | null
          salary_min: number | null
          salary_range: string | null
          status: Database["public"]["Enums"]["job_posting_status"]
          updated_at: string | null
          visa_requirement: string | null
        }
        Insert: {
          ai_summary?: string | null
          company_name?: string | null
          company_url?: string | null
          created_at?: string
          description?: string | null
          embedding_new?: string | null
          embedding_updated_at?: string | null
          equity_max?: number | null
          equity_min?: number | null
          equity_range?: string | null
          experience?: string | null
          experience_max?: number | null
          experience_min?: number
          id?: string
          is_platform_job?: boolean
          job_name?: string | null
          job_type?: Database["public"]["Enums"]["job_type_enum"]
          job_url?: string | null
          locations?: string[]
          normalized_locations?: string[] | null
          platform?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_range?: string | null
          status?: Database["public"]["Enums"]["job_posting_status"]
          updated_at?: string | null
          visa_requirement?: string | null
        }
        Update: {
          ai_summary?: string | null
          company_name?: string | null
          company_url?: string | null
          created_at?: string
          description?: string | null
          embedding_new?: string | null
          embedding_updated_at?: string | null
          equity_max?: number | null
          equity_min?: number | null
          equity_range?: string | null
          experience?: string | null
          experience_max?: number | null
          experience_min?: number
          id?: string
          is_platform_job?: boolean
          job_name?: string | null
          job_type?: Database["public"]["Enums"]["job_type_enum"]
          job_url?: string | null
          locations?: string[]
          normalized_locations?: string[] | null
          platform?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_range?: string | null
          status?: Database["public"]["Enums"]["job_posting_status"]
          updated_at?: string | null
          visa_requirement?: string | null
        }
        Relationships: []
      }
      all_jobs_archive: {
        Row: {
          ai_summary: string | null
          company_name: string | null
          company_url: string | null
          created_at: string
          description: string | null
          embedding_new: string | null
          embedding_updated_at: string | null
          equity_max: number | null
          equity_min: number | null
          equity_range: string | null
          experience: string | null
          experience_max: number | null
          experience_min: number | null
          id: string
          is_platform_job: boolean
          job_name: string | null
          job_type: string | null
          job_url: string | null
          locations: string[]
          normalized_locations: string[] | null
          platform: string | null
          salary_max: number | null
          salary_min: number | null
          salary_range: string | null
          status: Database["public"]["Enums"]["job_posting_status"]
          updated_at: string | null
          visa_requirement: string | null
        }
        Insert: {
          ai_summary?: string | null
          company_name?: string | null
          company_url?: string | null
          created_at?: string
          description?: string | null
          embedding_new?: string | null
          embedding_updated_at?: string | null
          equity_max?: number | null
          equity_min?: number | null
          equity_range?: string | null
          experience?: string | null
          experience_max?: number | null
          experience_min?: number | null
          id?: string
          is_platform_job?: boolean
          job_name?: string | null
          job_type?: string | null
          job_url?: string | null
          locations?: string[]
          normalized_locations?: string[] | null
          platform?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_range?: string | null
          status?: Database["public"]["Enums"]["job_posting_status"]
          updated_at?: string | null
          visa_requirement?: string | null
        }
        Update: {
          ai_summary?: string | null
          company_name?: string | null
          company_url?: string | null
          created_at?: string
          description?: string | null
          embedding_new?: string | null
          embedding_updated_at?: string | null
          equity_max?: number | null
          equity_min?: number | null
          equity_range?: string | null
          experience?: string | null
          experience_max?: number | null
          experience_min?: number | null
          id?: string
          is_platform_job?: boolean
          job_name?: string | null
          job_type?: string | null
          job_url?: string | null
          locations?: string[]
          normalized_locations?: string[] | null
          platform?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_range?: string | null
          status?: Database["public"]["Enums"]["job_posting_status"]
          updated_at?: string | null
          visa_requirement?: string | null
        }
        Relationships: []
      }
      application_attachments: {
        Row: {
          application_id: string
          created_at: string
          first_viewed_at: string | null
          id: string
          interview_session_id: string | null
          kind: string
          resume_review_id: string | null
        }
        Insert: {
          application_id: string
          created_at?: string
          first_viewed_at?: string | null
          id?: string
          interview_session_id?: string | null
          kind: string
          resume_review_id?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string
          first_viewed_at?: string | null
          id?: string
          interview_session_id?: string | null
          kind?: string
          resume_review_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_attachments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_attachments_interview_session_id_fkey"
            columns: ["interview_session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_attachments_resume_review_id_fkey"
            columns: ["resume_review_id"]
            isOneToOne: false
            referencedRelation: "resume_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      application_events: {
        Row: {
          actor_name: string | null
          actor_user_id: string | null
          application_id: string | null
          candidate_user_id: string | null
          company_id: string
          created_at: string
          id: string
          payload: Json
          type: string
        }
        Insert: {
          actor_name?: string | null
          actor_user_id?: string | null
          application_id?: string | null
          candidate_user_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          payload?: Json
          type: string
        }
        Update: {
          actor_name?: string | null
          actor_user_id?: string | null
          application_id?: string | null
          candidate_user_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      application_screenings: {
        Row: {
          application_id: string
          attempts: number
          company_id: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          fit_score: number | null
          id: string
          job_post_id: string
          job_snapshot_hash: string | null
          model: string | null
          previous_result: Json | null
          recommendation:
            | Database["public"]["Enums"]["screening_recommendation"]
            | null
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          attempts?: number
          company_id: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          fit_score?: number | null
          id?: string
          job_post_id: string
          job_snapshot_hash?: string | null
          model?: string | null
          previous_result?: Json | null
          recommendation?:
            | Database["public"]["Enums"]["screening_recommendation"]
            | null
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          attempts?: number
          company_id?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          fit_score?: number | null
          id?: string
          job_post_id?: string
          job_snapshot_hash?: string | null
          model?: string | null
          previous_result?: Json | null
          recommendation?:
            | Database["public"]["Enums"]["screening_recommendation"]
            | null
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_screenings_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_screenings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_screenings_job_post_id_fkey"
            columns: ["job_post_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          all_jobs_id: string | null
          answers: string[]
          applicant_user_id: string | null
          created_at: string
          id: string
          job_post_id: string | null
          resume_id: string | null
          resume_path: string | null
          resume_url: string | null
          source: string
          stage_entered_at: string
          stage_id: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
        }
        Insert: {
          all_jobs_id?: string | null
          answers?: string[]
          applicant_user_id?: string | null
          created_at?: string
          id?: string
          job_post_id?: string | null
          resume_id?: string | null
          resume_path?: string | null
          resume_url?: string | null
          source?: string
          stage_entered_at?: string
          stage_id?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Update: {
          all_jobs_id?: string | null
          answers?: string[]
          applicant_user_id?: string | null
          created_at?: string
          id?: string
          job_post_id?: string | null
          resume_id?: string | null
          resume_path?: string | null
          resume_url?: string | null
          source?: string
          stage_entered_at?: string
          stage_id?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_all_jobs_id_fkey"
            columns: ["all_jobs_id"]
            isOneToOne: false
            referencedRelation: "all_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_applicant_user_id_fkey"
            columns: ["applicant_user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "applications_applicant_user_id_fkey"
            columns: ["applicant_user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "applications_job_post_id_fkey"
            columns: ["job_post_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_webhook_events: {
        Row: {
          error: string | null
          event_type: string
          payload: Json
          processed_at: string | null
          received_at: string
          webhook_id: string
        }
        Insert: {
          error?: string | null
          event_type: string
          payload: Json
          processed_at?: string | null
          received_at?: string
          webhook_id: string
        }
        Update: {
          error?: string | null
          event_type?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          webhook_id?: string
        }
        Relationships: []
      }
      bookmarks: {
        Row: {
          created_at: string
          id: string
          is_alert_on: boolean
          name: string
          updated_at: string | null
          url: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_alert_on?: boolean
          name: string
          updated_at?: string | null
          url?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_alert_on?: boolean
          name?: string
          updated_at?: string | null
          url?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      candidate_company_blocks: {
        Row: {
          candidate_user_id: string
          company_id: string
          created_at: string
        }
        Insert: {
          candidate_user_id: string
          company_id: string
          created_at?: string
        }
        Update: {
          candidate_user_id?: string
          company_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_company_blocks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_notes: {
        Row: {
          application_id: string | null
          author_name: string | null
          author_user_id: string
          body: string
          candidate_user_id: string
          company_id: string
          created_at: string
          id: string
          rating: Database["public"]["Enums"]["candidate_rating"] | null
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          author_name?: string | null
          author_user_id: string
          body: string
          candidate_user_id: string
          company_id: string
          created_at?: string
          id?: string
          rating?: Database["public"]["Enums"]["candidate_rating"] | null
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          author_name?: string | null
          author_user_id?: string
          body?: string
          candidate_user_id?: string
          company_id?: string
          created_at?: string
          id?: string
          rating?: Database["public"]["Enums"]["candidate_rating"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_notes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_outreach: {
        Row: {
          candidate_contact: string | null
          candidate_note: string | null
          candidate_user_id: string
          company_id: string
          decline_reason: string | null
          expires_at: string
          id: string
          job_post_id: string | null
          message: string
          responded_at: string | null
          sender_user_id: string | null
          sent_at: string
          source: string
          status: string
          subject: string
        }
        Insert: {
          candidate_contact?: string | null
          candidate_note?: string | null
          candidate_user_id: string
          company_id: string
          decline_reason?: string | null
          expires_at?: string
          id?: string
          job_post_id?: string | null
          message: string
          responded_at?: string | null
          sender_user_id?: string | null
          sent_at?: string
          source?: string
          status?: string
          subject: string
        }
        Update: {
          candidate_contact?: string | null
          candidate_note?: string | null
          candidate_user_id?: string
          company_id?: string
          decline_reason?: string | null
          expires_at?: string
          id?: string
          job_post_id?: string | null
          message?: string
          responded_at?: string | null
          sender_user_id?: string | null
          sent_at?: string
          source?: string
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_outreach_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_outreach_job_post_id_fkey"
            columns: ["job_post_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_profile_views: {
        Row: {
          candidate_user_id: string
          company_id: string
          viewed_on: string
          views: number
        }
        Insert: {
          candidate_user_id: string
          company_id: string
          viewed_on?: string
          views?: number
        }
        Update: {
          candidate_user_id?: string
          company_id?: string
          viewed_on?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "candidate_profile_views_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      company_billing_audit: {
        Row: {
          action: string
          company_id: string
          created_at: string
          created_by: string | null
          details: Json
          id: string
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string
          created_by?: string | null
          details?: Json
          id?: string
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          details?: Json
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_billing_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      company_credit_ledger: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          delta: number
          expires_at: string | null
          id: string
          key: string | null
          note: string | null
          payment_id: string | null
          reason: string
          ref_id: string | null
          ref_type: string | null
          remaining: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          delta: number
          expires_at?: string | null
          id?: string
          key?: string | null
          note?: string | null
          payment_id?: string | null
          reason: string
          ref_id?: string | null
          ref_type?: string | null
          remaining?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          delta?: number
          expires_at?: string | null
          id?: string
          key?: string | null
          note?: string | null
          payment_id?: string | null
          reason?: string
          ref_id?: string | null
          ref_type?: string | null
          remaining?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "company_credit_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_credit_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      company_email_templates: {
        Row: {
          body_md: string
          company_id: string
          id: string
          is_default: boolean
          name: string
          purpose: string
          subject: string
          updated_at: string
        }
        Insert: {
          body_md: string
          company_id: string
          id?: string
          is_default?: boolean
          name: string
          purpose: string
          subject: string
          updated_at?: string
        }
        Update: {
          body_md?: string
          company_id?: string
          id?: string
          is_default?: boolean
          name?: string
          purpose?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_email_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      company_entitlement_holds: {
        Row: {
          company_id: string
          created_at: string
          expires_at: string
          id: string
          key: string
          qty: number
          ref_id: string
          ref_type: string
        }
        Insert: {
          company_id: string
          created_at?: string
          expires_at?: string
          id?: string
          key: string
          qty: number
          ref_id: string
          ref_type: string
        }
        Update: {
          company_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          key?: string
          qty?: number
          ref_id?: string
          ref_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_entitlement_holds_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      company_favorites: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_favorites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "company_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      company_info: {
        Row: {
          ai_credits: number
          company_size: string | null
          created_at: string
          description: string | null
          email: string | null
          embedding: string | null
          embedding_new: string | null
          embedding_updated_at: string | null
          filled: boolean
          headquarters: string | null
          id: string
          industry: string | null
          is_relevant_profiles_generated: boolean
          job_posts_created: number
          last_applicant_digest_at: string | null
          logo_url: string | null
          name: string | null
          notify_new_applicants: string
          notify_weekly_matches: boolean
          scheduling_url: string | null
          tag_line: string | null
          tier_id: string
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          ai_credits?: number
          company_size?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          embedding?: string | null
          embedding_new?: string | null
          embedding_updated_at?: string | null
          filled?: boolean
          headquarters?: string | null
          id?: string
          industry?: string | null
          is_relevant_profiles_generated?: boolean
          job_posts_created?: number
          last_applicant_digest_at?: string | null
          logo_url?: string | null
          name?: string | null
          notify_new_applicants?: string
          notify_weekly_matches?: boolean
          scheduling_url?: string | null
          tag_line?: string | null
          tier_id?: string
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          ai_credits?: number
          company_size?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          embedding?: string | null
          embedding_new?: string | null
          embedding_updated_at?: string | null
          filled?: boolean
          headquarters?: string | null
          id?: string
          industry?: string | null
          is_relevant_profiles_generated?: boolean
          job_posts_created?: number
          last_applicant_digest_at?: string | null
          logo_url?: string | null
          name?: string | null
          notify_new_applicants?: string
          notify_weekly_matches?: boolean
          scheduling_url?: string | null
          tag_line?: string | null
          tier_id?: string
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_info_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "company_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      company_subscriptions: {
        Row: {
          billing_interval: string | null
          cancel_at_period_end: boolean
          company_id: string
          currency: string | null
          current_period_end: string
          current_period_start: string
          dodo_customer_id: string | null
          dodo_subscription_id: string | null
          grace_until: string | null
          manual_until: string | null
          scheduled_tier_id: string | null
          status: string
          tier_id: string
          updated_at: string
        }
        Insert: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          company_id: string
          currency?: string | null
          current_period_end?: string
          current_period_start?: string
          dodo_customer_id?: string | null
          dodo_subscription_id?: string | null
          grace_until?: string | null
          manual_until?: string | null
          scheduled_tier_id?: string | null
          status?: string
          tier_id: string
          updated_at?: string
        }
        Update: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          company_id?: string
          currency?: string | null
          current_period_end?: string
          current_period_start?: string
          dodo_customer_id?: string | null
          dodo_subscription_id?: string | null
          grace_until?: string | null
          manual_until?: string | null
          scheduled_tier_id?: string | null
          status?: string
          tier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_subscriptions_scheduled_tier_id_fkey"
            columns: ["scheduled_tier_id"]
            isOneToOne: false
            referencedRelation: "company_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_subscriptions_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "company_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      company_tiers: {
        Row: {
          created_at: string
          description: string | null
          features: string[]
          id: string
          is_public: boolean
          name: string | null
          price_plan_id: string | null
          prices: Json
          slug: string | null
          sort: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          features?: string[]
          id?: string
          is_public?: boolean
          name?: string | null
          price_plan_id?: string | null
          prices?: Json
          slug?: string | null
          sort?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          features?: string[]
          id?: string
          is_public?: boolean
          name?: string | null
          price_plan_id?: string | null
          prices?: Json
          slug?: string | null
          sort?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_tiers_price_plan_id_fkey"
            columns: ["price_plan_id"]
            isOneToOne: false
            referencedRelation: "price_plan"
            referencedColumns: ["id"]
          },
        ]
      }
      company_usage: {
        Row: {
          company_id: string
          key: string
          notified_100: boolean
          notified_80: boolean
          period_start: string
          used: number
        }
        Insert: {
          company_id: string
          key: string
          notified_100?: boolean
          notified_80?: boolean
          period_start: string
          used?: number
        }
        Update: {
          company_id?: string
          key?: string
          notified_100?: boolean
          notified_80?: boolean
          period_start?: string
          used?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_usage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      company_usage_events: {
        Row: {
          actor_user_id: string | null
          company_id: string
          created_at: string
          credits_spent: number
          id: string
          key: string
          qty: number
          ref_id: string
          ref_type: string
          source: string
        }
        Insert: {
          actor_user_id?: string | null
          company_id: string
          created_at?: string
          credits_spent?: number
          id?: string
          key: string
          qty: number
          ref_id: string
          ref_type: string
          source: string
        }
        Update: {
          actor_user_id?: string | null
          company_id?: string
          created_at?: string
          credits_spent?: number
          id?: string
          key?: string
          qty?: number
          ref_id?: string
          ref_type?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_usage_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      countries_and_cities: {
        Row: {
          cities: string[] | null
          country: string | null
          created_at: string
          id: string
          iso: string | null
          updated_at: string | null
        }
        Insert: {
          cities?: string[] | null
          country?: string | null
          created_at?: string
          id?: string
          iso?: string | null
          updated_at?: string | null
        }
        Update: {
          cities?: string[] | null
          country?: string | null
          created_at?: string
          id?: string
          iso?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      feedbacks: {
        Row: {
          company_user_id: string | null
          content: string | null
          created_at: string
          id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          company_user_id?: string | null
          content?: string | null
          created_at?: string
          id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          company_user_id?: string | null
          content?: string | null
          created_at?: string
          id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedbacks_company_user_id_fkey"
            columns: ["company_user_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feedbacks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feedbacks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      interview_analyses: {
        Row: {
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          interview_session_id: string
          notification_sent_at: string | null
          perspective: string
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          interview_session_id: string
          notification_sent_at?: string | null
          perspective?: string
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          interview_session_id?: string
          notification_sent_at?: string | null
          perspective?: string
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_analyses_interview_session_id_fkey"
            columns: ["interview_session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_sessions: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          interview_id: string
          started_at: string
          status: string
          turns: Json
          updated_at: string
          voice_session_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          interview_id: string
          started_at?: string
          status?: string
          turns?: Json
          updated_at?: string
          voice_session_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          interview_id?: string
          started_at?: string
          status?: string
          turns?: Json
          updated_at?: string
          voice_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_sessions_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          active_session_id: string | null
          active_session_updated_at: string | null
          charged_session_ids: string[]
          created_at: string
          id: string
          job_id: string | null
          name: string | null
          resume_id: string | null
          turns: Json
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          active_session_id?: string | null
          active_session_updated_at?: string | null
          charged_session_ids?: string[]
          created_at?: string
          id?: string
          job_id?: string | null
          name?: string | null
          resume_id?: string | null
          turns?: Json
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          active_session_id?: string | null
          active_session_updated_at?: string | null
          charged_session_ids?: string[]
          created_at?: string
          id?: string
          job_id?: string | null
          name?: string | null
          resume_id?: string | null
          turns?: Json
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "all_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "interviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          id: string
          invited_email: string | null
          isDialogShown: boolean
          referrer_user_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          invited_email?: string | null
          isDialogShown?: boolean
          referrer_user_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          invited_email?: string | null
          isDialogShown?: boolean
          referrer_user_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_referrer_user_id_fkey"
            columns: ["referrer_user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invitations_referrer_user_id_fkey"
            columns: ["referrer_user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      job_feedback: {
        Row: {
          created_at: string
          id: string
          job_id: string
          updated_at: string
          user_id: string | null
          vote_type: Database["public"]["Enums"]["job_feedback_vote"]
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          updated_at?: string
          user_id?: string | null
          vote_type?: Database["public"]["Enums"]["job_feedback_vote"]
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          updated_at?: string
          user_id?: string | null
          vote_type?: Database["public"]["Enums"]["job_feedback_vote"]
        }
        Relationships: [
          {
            foreignKeyName: "job_feedback_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "all_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "job_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      job_postings: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          embedding: string | null
          embedding_new: string | null
          embedding_updated_at: string | null
          equity_range: string | null
          experience: string | null
          id: string
          job_id: string | null
          job_type: Database["public"]["Enums"]["job_type_enum"]
          last_applicant_notified_at: string | null
          location: string[]
          matched_at: string | null
          matching_error: string | null
          matching_status: Database["public"]["Enums"]["job_posting_matching_status"]
          max_equity: number | null
          max_experience: number | null
          max_salary: number | null
          min_equity: number | null
          min_experience: number | null
          min_salary: number | null
          questions: string[]
          salary_currency: string | null
          salary_range: string | null
          skills: string[]
          status: Database["public"]["Enums"]["job_posting_status"]
          title: string
          updated_at: string
          visa_sponsorship: Database["public"]["Enums"]["visa_job_postings"]
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          embedding?: string | null
          embedding_new?: string | null
          embedding_updated_at?: string | null
          equity_range?: string | null
          experience?: string | null
          id?: string
          job_id?: string | null
          job_type?: Database["public"]["Enums"]["job_type_enum"]
          last_applicant_notified_at?: string | null
          location?: string[]
          matched_at?: string | null
          matching_error?: string | null
          matching_status?: Database["public"]["Enums"]["job_posting_matching_status"]
          max_equity?: number | null
          max_experience?: number | null
          max_salary?: number | null
          min_equity?: number | null
          min_experience?: number | null
          min_salary?: number | null
          questions?: string[]
          salary_currency?: string | null
          salary_range?: string | null
          skills?: string[]
          status?: Database["public"]["Enums"]["job_posting_status"]
          title: string
          updated_at?: string
          visa_sponsorship?: Database["public"]["Enums"]["visa_job_postings"]
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          embedding?: string | null
          embedding_new?: string | null
          embedding_updated_at?: string | null
          equity_range?: string | null
          experience?: string | null
          id?: string
          job_id?: string | null
          job_type?: Database["public"]["Enums"]["job_type_enum"]
          last_applicant_notified_at?: string | null
          location?: string[]
          matched_at?: string | null
          matching_error?: string | null
          matching_status?: Database["public"]["Enums"]["job_posting_matching_status"]
          max_equity?: number | null
          max_experience?: number | null
          max_salary?: number | null
          min_equity?: number | null
          min_experience?: number | null
          min_salary?: number | null
          questions?: string[]
          salary_currency?: string | null
          salary_range?: string | null
          skills?: string[]
          status?: Database["public"]["Enums"]["job_posting_status"]
          title?: string
          updated_at?: string
          visa_sponsorship?: Database["public"]["Enums"]["visa_job_postings"]
        }
        Relationships: [
          {
            foreignKeyName: "job_postings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_postings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "all_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_relevant_profiles: {
        Row: {
          created_at: string
          experience_score: number | null
          explained_at: string | null
          explanation: Json | null
          explanation_error: string | null
          explanation_status: string
          id: string
          job_posting_id: string | null
          match_score: number | null
          preference_conflict: number | null
          relevance_rank: number | null
          skills_score: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          experience_score?: number | null
          explained_at?: string | null
          explanation?: Json | null
          explanation_error?: string | null
          explanation_status?: string
          id?: string
          job_posting_id?: string | null
          match_score?: number | null
          preference_conflict?: number | null
          relevance_rank?: number | null
          skills_score?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          experience_score?: number | null
          explained_at?: string | null
          explanation?: Json | null
          explanation_error?: string | null
          explanation_status?: string
          id?: string
          job_posting_id?: string | null
          match_score?: number | null
          preference_conflict?: number | null
          relevance_rank?: number | null
          skills_score?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_relevant_users_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_relevant_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "job_relevant_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      location_aliases: {
        Row: {
          alias: string
          canonical_name: string
        }
        Insert: {
          alias: string
          canonical_name: string
        }
        Update: {
          alias?: string
          canonical_name?: string
        }
        Relationships: []
      }
      outreach_draft_usage: {
        Row: {
          company_id: string
          count: number
          day: string
        }
        Insert: {
          company_id: string
          count?: number
          day?: string
        }
        Update: {
          company_id?: string
          count?: number
          day?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_draft_usage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          billing: Json | null
          company_id: string | null
          created_at: string
          credit_amount: number | null
          credits_fulfilled: boolean | null
          currency: string | null
          customer: Json | null
          email_sent: boolean | null
          failure_reason: string | null
          fulfillment_date: string | null
          id: string
          kind: string
          payment_id: string | null
          price_plan_id: string | null
          product_id: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          tier_id: string | null
          total_amount: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          billing?: Json | null
          company_id?: string | null
          created_at?: string
          credit_amount?: number | null
          credits_fulfilled?: boolean | null
          currency?: string | null
          customer?: Json | null
          email_sent?: boolean | null
          failure_reason?: string | null
          fulfillment_date?: string | null
          id?: string
          kind?: string
          payment_id?: string | null
          price_plan_id?: string | null
          product_id?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tier_id?: string | null
          total_amount?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          billing?: Json | null
          company_id?: string | null
          created_at?: string
          credit_amount?: number | null
          credits_fulfilled?: boolean | null
          currency?: string | null
          customer?: Json | null
          email_sent?: boolean | null
          failure_reason?: string | null
          fulfillment_date?: string | null
          id?: string
          kind?: string
          payment_id?: string | null
          price_plan_id?: string | null
          product_id?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tier_id?: string | null
          total_amount?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_price_plan_id_fkey"
            columns: ["price_plan_id"]
            isOneToOne: false
            referencedRelation: "price_plan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "company_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          archived: boolean
          company_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["pipeline_stage_kind"]
          name: string
          position: number
        }
        Insert: {
          archived?: boolean
          company_id: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["pipeline_stage_kind"]
          name: string
          position: number
        }
        Update: {
          archived?: boolean
          company_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["pipeline_stage_kind"]
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      price_plan: {
        Row: {
          amount: number | null
          audience: string
          created_at: string
          credit_amount: number | null
          currency: string | null
          description: string | null
          id: string
          name: string | null
          product_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          audience?: string
          created_at?: string
          credit_amount?: number | null
          currency?: string | null
          description?: string | null
          id?: string
          name?: string | null
          product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          audience?: string
          created_at?: string
          credit_amount?: number | null
          currency?: string | null
          description?: string | null
          id?: string
          name?: string | null
          product_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      resume_public_sections: {
        Row: {
          resume_id: string
          sections: Json
          updated_at: string
        }
        Insert: {
          resume_id: string
          sections?: Json
          updated_at?: string
        }
        Update: {
          resume_id?: string
          sections?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resume_public_sections_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: true
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_reviews: {
        Row: {
          ai_response: Json | null
          analysis_failed: boolean | null
          created_at: string
          id: string
          job_id: string | null
          name: string | null
          resume_id: string | null
          score: number | null
          status: string | null
          target_jd: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          ai_response?: Json | null
          analysis_failed?: boolean | null
          created_at?: string
          id?: string
          job_id?: string | null
          name?: string | null
          resume_id?: string | null
          score?: number | null
          status?: string | null
          target_jd?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          ai_response?: Json | null
          analysis_failed?: boolean | null
          created_at?: string
          id?: string
          job_id?: string | null
          name?: string | null
          resume_id?: string | null
          score?: number | null
          status?: string | null
          target_jd?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resume_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "all_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_reviews_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "resume_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      resumes: {
        Row: {
          content: Json | null
          created_at: string
          id: string
          is_primary: boolean
          name: string | null
          parsing_failed: boolean
          resume_path: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          content?: Json | null
          created_at?: string
          id?: string
          is_primary?: boolean
          name?: string | null
          parsing_failed?: boolean
          resume_path?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          content?: Json | null
          created_at?: string
          id?: string
          is_primary?: boolean
          name?: string | null
          parsing_failed?: boolean
          resume_path?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resumes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "resumes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      scraper_state: {
        Row: {
          created_at: string
          historical_scraped_urls: string[]
          id: string
          newest_company_url: string | null
          oldest_company_url: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          historical_scraped_urls?: string[]
          id?: string
          newest_company_url?: string | null
          oldest_company_url?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          historical_scraped_urls?: string[]
          id?: string
          newest_company_url?: string | null
          oldest_company_url?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      talent_list_members: {
        Row: {
          added_at: string
          candidate_user_id: string
          list_id: string
        }
        Insert: {
          added_at?: string
          candidate_user_id: string
          list_id: string
        }
        Update: {
          added_at?: string
          candidate_user_id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "talent_list_members_candidate_user_id_fkey"
            columns: ["candidate_user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "talent_list_members_candidate_user_id_fkey"
            columns: ["candidate_user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "talent_list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "talent_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      talent_lists: {
        Row: {
          company_id: string
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "talent_lists_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_entitlements: {
        Row: {
          amount: number | null
          key: string
          kind: string
          overage_credits: number | null
          tier_id: string
        }
        Insert: {
          amount?: number | null
          key: string
          kind: string
          overage_credits?: number | null
          tier_id: string
        }
        Update: {
          amount?: number | null
          key?: string
          kind?: string
          overage_credits?: number | null
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_entitlements_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "company_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_api_tokens: {
        Row: {
          created_at: string | null
          id: string
          last_used_at: string | null
          name: string
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_api_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_api_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_favorites: {
        Row: {
          created_at: string
          id: string
          job_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          job_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_favorites_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "all_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_favorites_companies: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_favorites_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_favorites_companies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_favorites_companies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_info: {
        Row: {
          accepts_outreach: boolean
          ai_credits: number
          career_goals_long_term: string | null
          career_goals_short_term: string | null
          company_size_preference: string | null
          created_at: string | null
          desired_roles: string[] | null
          email: string
          embedding_new: string | null
          embedding_updated_at: string | null
          experience_years: number | null
          filled: boolean
          full_name: string | null
          github_url: string | null
          industry_preferences: string[] | null
          invitations_count: number
          is_job_digest_active: boolean
          is_promotion_active: boolean
          is_public: boolean
          job_type: string[]
          last_promo_version_seen: string | null
          linkedin_url: string | null
          matched_at: string | null
          max_salary: number | null
          min_salary: number | null
          preferred_locations: string[] | null
          referral_code: string | null
          relevant_jobs_update_status: Database["public"]["Enums"]["job_posting_matching_status"]
          salary_currency: string
          top_skills: string[] | null
          updated_at: string | null
          user_id: string
          visa_sponsorship_required: boolean | null
          work_style_preferences: string[] | null
          desired_roles_search: string | null
          industry_preferences_search: string | null
          top_skills_search: string | null
          work_style_preferences_search: string | null
        }
        Insert: {
          accepts_outreach?: boolean
          ai_credits?: number
          career_goals_long_term?: string | null
          career_goals_short_term?: string | null
          company_size_preference?: string | null
          created_at?: string | null
          desired_roles?: string[] | null
          email: string
          embedding_new?: string | null
          embedding_updated_at?: string | null
          experience_years?: number | null
          filled?: boolean
          full_name?: string | null
          github_url?: string | null
          industry_preferences?: string[] | null
          invitations_count?: number
          is_job_digest_active?: boolean
          is_promotion_active?: boolean
          is_public?: boolean
          job_type?: string[]
          last_promo_version_seen?: string | null
          linkedin_url?: string | null
          matched_at?: string | null
          max_salary?: number | null
          min_salary?: number | null
          preferred_locations?: string[] | null
          referral_code?: string | null
          relevant_jobs_update_status?: Database["public"]["Enums"]["job_posting_matching_status"]
          salary_currency?: string
          top_skills?: string[] | null
          updated_at?: string | null
          user_id: string
          visa_sponsorship_required?: boolean | null
          work_style_preferences?: string[] | null
        }
        Update: {
          accepts_outreach?: boolean
          ai_credits?: number
          career_goals_long_term?: string | null
          career_goals_short_term?: string | null
          company_size_preference?: string | null
          created_at?: string | null
          desired_roles?: string[] | null
          email?: string
          embedding_new?: string | null
          embedding_updated_at?: string | null
          experience_years?: number | null
          filled?: boolean
          full_name?: string | null
          github_url?: string | null
          industry_preferences?: string[] | null
          invitations_count?: number
          is_job_digest_active?: boolean
          is_promotion_active?: boolean
          is_public?: boolean
          job_type?: string[]
          last_promo_version_seen?: string | null
          linkedin_url?: string | null
          matched_at?: string | null
          max_salary?: number | null
          min_salary?: number | null
          preferred_locations?: string[] | null
          referral_code?: string | null
          relevant_jobs_update_status?: Database["public"]["Enums"]["job_posting_matching_status"]
          salary_currency?: string
          top_skills?: string[] | null
          updated_at?: string | null
          user_id?: string
          visa_sponsorship_required?: boolean | null
          work_style_preferences?: string[] | null
        }
        Relationships: []
      }
      user_relevant_jobs: {
        Row: {
          created_at: string
          id: string
          jobs_id: string | null
          relevance_rank: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          jobs_id?: string | null
          relevance_rank?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          jobs_id?: string | null
          relevance_rank?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_relevant_jobs_jobs_id_fkey"
            columns: ["jobs_id"]
            isOneToOne: false
            referencedRelation: "all_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_relevant_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "candidate_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_relevant_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_info"
            referencedColumns: ["user_id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          type: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      candidate_directory: {
        Row: {
          accepts_outreach: boolean | null
          career_goals_long_term: string | null
          career_goals_short_term: string | null
          company_size_preference: string | null
          created_at: string | null
          desired_roles: string[] | null
          desired_roles_search: string | null
          experience_years: number | null
          filled: boolean | null
          full_name: string | null
          industry_preferences: string[] | null
          industry_preferences_search: string | null
          is_public: boolean | null
          job_type: string[] | null
          max_salary: number | null
          min_salary: number | null
          preferred_locations: string[] | null
          resume_sections: Json | null
          salary_currency: string | null
          top_skills: string[] | null
          top_skills_search: string | null
          updated_at: string | null
          user_id: string | null
          visa_sponsorship_required: boolean | null
          work_style_preferences: string[] | null
          work_style_preferences_search: string | null
        }
        Insert: {
          accepts_outreach?: boolean | null
          career_goals_long_term?: string | null
          career_goals_short_term?: string | null
          company_size_preference?: string | null
          created_at?: string | null
          desired_roles?: string[] | null
          desired_roles_search?: never
          experience_years?: number | null
          filled?: boolean | null
          full_name?: string | null
          industry_preferences?: string[] | null
          industry_preferences_search?: never
          is_public?: boolean | null
          job_type?: string[] | null
          max_salary?: number | null
          min_salary?: number | null
          preferred_locations?: string[] | null
          resume_sections?: never
          salary_currency?: string | null
          top_skills?: string[] | null
          top_skills_search?: never
          updated_at?: string | null
          user_id?: string | null
          visa_sponsorship_required?: boolean | null
          work_style_preferences?: string[] | null
          work_style_preferences_search?: never
        }
        Update: {
          accepts_outreach?: boolean | null
          career_goals_long_term?: string | null
          career_goals_short_term?: string | null
          company_size_preference?: string | null
          created_at?: string | null
          desired_roles?: string[] | null
          desired_roles_search?: never
          experience_years?: number | null
          filled?: boolean | null
          full_name?: string | null
          industry_preferences?: string[] | null
          industry_preferences_search?: never
          is_public?: boolean | null
          job_type?: string[] | null
          max_salary?: number | null
          min_salary?: number | null
          preferred_locations?: string[] | null
          resume_sections?: never
          salary_currency?: string | null
          top_skills?: string[] | null
          top_skills_search?: never
          updated_at?: string | null
          user_id?: string | null
          visa_sponsorship_required?: boolean | null
          work_style_preferences?: string[] | null
          work_style_preferences_search?: never
        }
        Relationships: []
      }
      flat_locations: {
        Row: {
          city: string | null
          country: string | null
          id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_interview_session: {
        Args: {
          p_interview_id: string
          p_reservation_id: string
          p_session_id: string
        }
        Returns: boolean
      }
      algorithm_sign: {
        Args: { algorithm: string; secret: string; signables: string }
        Returns: string
      }
      application_status_for_kind: {
        Args: { p_kind: Database["public"]["Enums"]["pipeline_stage_kind"] }
        Returns: Database["public"]["Enums"]["application_status"]
      }
      apply_subscription_event: {
        Args: { p_company_id: string; p_event: Json }
        Returns: Json
      }
      backfill_recruiter_pipeline: { Args: never; Returns: undefined }
      billing_allowance_used: {
        Args: { p_company_id: string; p_key: string }
        Returns: number
      }
      billing_assert_key: { Args: { p_key: string }; Returns: undefined }
      billing_can_activate_job_post: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      billing_credit_balance: {
        Args: { p_company_id: string }
        Returns: number
      }
      billing_free_tier_id: { Args: never; Returns: string }
      billing_held: {
        Args: { p_company_id: string; p_key: string }
        Returns: number
      }
      billing_is_limit_key: { Args: { p_key: string }; Returns: boolean }
      billing_limit_used: {
        Args: { p_company_id: string; p_key: string }
        Returns: number
      }
      billing_period_start: { Args: { p_company_id: string }; Returns: string }
      billing_refresh_credit_cache: {
        Args: { p_company_id: string }
        Returns: number
      }
      billing_spend_credits: {
        Args: {
          p_actor: string
          p_amount: number
          p_company_id: string
          p_key: string
          p_ref_id: string
          p_ref_type: string
        }
        Returns: undefined
      }
      billing_tier_for_product: {
        Args: { p_product_id: string }
        Returns: {
          billing_interval: string
          currency: string
          tier_id: string
        }[]
      }
      billing_usage_alerts: {
        Args: never
        Returns: {
          amount: number
          company_id: string
          key: string
          period_start: string
          threshold: number
          used: number
        }[]
      }
      check_entitlement: {
        Args: { p_company_id: string; p_key: string; p_qty?: number }
        Returns: Json
      }
      company_can_view_candidate: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      company_effective_tier: {
        Args: { p_company_id: string }
        Returns: string
      }
      company_has_candidate_access: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      consume_entitlement: {
        Args: {
          p_actor?: string
          p_company_id: string
          p_key: string
          p_qty: number
          p_ref_id: string
          p_ref_type: string
        }
        Returns: Json
      }
      deduct_interview_session_credits: {
        Args: { p_interview_id: string; p_session_id: string }
        Returns: string
      }
      deduct_user_credits: {
        Args: { p_amount: number; p_user_id: string }
        Returns: undefined
      }
      desired_roles_search: {
        Args: { "": Database["public"]["Tables"]["user_info"]["Row"] }
        Returns: {
          error: true
        } & "the function public.desired_roles_search with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
      }
      enqueue_company_interview_analysis: {
        Args: { p_session: string }
        Returns: Json
      }
      enqueue_missing_job_embeddings: {
        Args: { p_batch_size?: number }
        Returns: number
      }
      expire_outreach: { Args: never; Returns: number }
      finalize_interview_analysis_session: {
        Args: { p_session_id: string }
        Returns: Json
      }
      first_pipeline_stage: {
        Args: {
          p_company_id: string
          p_kind: Database["public"]["Enums"]["pipeline_stage_kind"]
        }
        Returns: string
      }
      fulfil_payment: {
        Args: {
          p_dodo_payment_id: string
          p_payment_row_id: string
          p_webhook_id: string
        }
        Returns: Json
      }
      get_applicant_weekly_metrics: {
        Args: { p_user_id: string }
        Returns: {
          applications_submitted_weekly: number
          jobs_favorited_weekly: number
          resume_reviews_created_weekly: number
          resumes_created_weekly: number
          status_updates_weekly: number
          user_id: string
        }[]
      }
      get_company_entitlements: {
        Args: { p_company_id: string }
        Returns: Json
      }
      get_company_metrics: {
        Args: { company_id: string }
        Returns: {
          new_applicants_today: number
          total_applicants: number
          total_jobs: number
        }[]
      }
      get_job_funnel: { Args: { p_job_post_id: string }; Returns: Json }
      get_masked_job_urls: {
        Args: { p_job_ids: string[]; p_user_id: string }
        Returns: {
          company_url: string
          id: string
          job_url: string
        }[]
      }
      get_masked_job_urls_test: {
        Args: { p_job_ids: string[]; p_user_id: string }
        Returns: {
          company_url: string
          id: string
          job_url: string
        }[]
      }
      get_my_profile_view_count: { Args: { p_days?: number }; Returns: number }
      get_platform_stats: {
        Args: never
        Returns: {
          application_count: number
          job_count: number
          resume_count: number
          user_count: number
        }[]
      }
      get_recruiter_job_summaries: {
        Args: {
          p_company_id: string
          p_limit?: number
          p_status?: Database["public"]["Enums"]["job_posting_status"]
        }
        Returns: {
          applicants: number
          created_at: string
          id: string
          matching_status: Database["public"]["Enums"]["job_posting_matching_status"]
          new_24h: number
          status: Database["public"]["Enums"]["job_posting_status"]
          title: string
          updated_at: string
        }[]
      }
      get_unique_companies: {
        Args: never
        Returns: {
          company_name: string
        }[]
      }
      get_unique_companies_company_info: {
        Args: never
        Returns: {
          company_name: string
        }[]
      }
      get_unique_locations: {
        Args: never
        Returns: {
          location: string
        }[]
      }
      get_unique_locations_company_info: {
        Args: never
        Returns: {
          location: string
        }[]
      }
      get_unique_profile_filters: { Args: never; Returns: Json }
      get_users_needing_match: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      grant_company_credits: {
        Args: {
          p_actor?: string
          p_amount: number
          p_company_id: string
          p_expires_at: string
          p_note?: string
          p_payment_id?: string
          p_reason: string
        }
        Returns: string
      }
      has_ai_credits_for: { Args: { p_user_id: string }; Returns: boolean }
      has_ai_credits_for_test: { Args: { p_user_id: string }; Returns: boolean }
      heartbeat_interview_session: {
        Args: { p_interview_id: string; p_session_id: string }
        Returns: boolean
      }
      hold_entitlement: {
        Args: {
          p_company_id: string
          p_expires_at?: string
          p_key: string
          p_qty: number
          p_ref_id: string
          p_ref_type: string
        }
        Returns: Json
      }
      increment_outreach_drafts: { Args: never; Returns: number }
      industry_preferences_search: {
        Args: { "": Database["public"]["Tables"]["user_info"]["Row"] }
        Returns: {
          error: true
        } & "the function public.industry_preferences_search with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
      }
      is_company_member: { Args: { p_company_id: string }; Returns: boolean }
      mark_usage_notified: {
        Args: {
          p_company_id: string
          p_key: string
          p_period_start: string
          p_threshold: number
        }
        Returns: undefined
      }
      match_all_companies: {
        Args: {
          match_count: number
          match_threshold: number
          query_embedding: string
        }
        Returns: {
          id: string
        }[]
      }
      match_all_jobs_test: {
        Args: {
          embedding: string
          match_count: number
          match_threshold: number
          min_created_at: string
        }
        Returns: {
          description: string
          distance_score: number
          experience: string
          id: string
          job_name: string
          job_type: string
          locations: string[]
        }[]
      }
      match_user_profiles: {
        Args: {
          job_embedding: string
          match_count: number
          match_threshold: number
        }
        Returns: {
          desired_roles: string[]
          experience_years: number
          full_name: string
          similarity_score: number
          top_skills: string[]
          user_id: string
        }[]
      }
      my_company_id: { Args: never; Returns: string }
      normalize_all_job_locations_test: {
        Args: { target_ids?: string[] }
        Returns: undefined
      }
      pipeline_kind_for_status: {
        Args: { p_status: Database["public"]["Enums"]["application_status"] }
        Returns: Database["public"]["Enums"]["pipeline_stage_kind"]
      }
      record_profile_view: { Args: { p_candidate: string }; Returns: undefined }
      redact_pii: { Args: { p_text: string }; Returns: string }
      release_hold: {
        Args: {
          p_company_id: string
          p_key: string
          p_ref_id: string
          p_ref_type: string
        }
        Returns: boolean
      }
      release_interview_session: {
        Args: { p_interview_id: string; p_session_id: string }
        Returns: boolean
      }
      reorder_pipeline_stages: { Args: { p_ids: string[] }; Returns: undefined }
      reserve_interview_session: {
        Args: { p_interview_id: string; p_reservation_id: string }
        Returns: string
      }
      respond_to_outreach: {
        Args: {
          p_block?: boolean
          p_contact?: string
          p_id: string
          p_note?: string
          p_reason?: string
          p_status: string
        }
        Returns: {
          candidate_contact: string | null
          candidate_note: string | null
          candidate_user_id: string
          company_id: string
          decline_reason: string | null
          expires_at: string
          id: string
          job_post_id: string | null
          message: string
          responded_at: string | null
          sender_user_id: string | null
          sent_at: string
          source: string
          status: string
          subject: string
        }
        SetofOptions: {
          from: "*"
          to: "candidate_outreach"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resume_sections_public: { Args: { p_content: Json }; Returns: Json }
      rollover_free_periods: { Args: never; Returns: Json }
      schedule_company_plan_change: {
        Args: { p_company_id: string; p_tier_slug: string }
        Returns: undefined
      }
      seed_default_pipeline: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      seed_default_templates: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      send_candidate_outreach: {
        Args: {
          p_candidate: string
          p_id: string
          p_job_post: string
          p_message: string
          p_source?: string
          p_subject: string
        }
        Returns: {
          candidate_contact: string | null
          candidate_note: string | null
          candidate_user_id: string
          company_id: string
          decline_reason: string | null
          expires_at: string
          id: string
          job_post_id: string | null
          message: string
          responded_at: string | null
          sender_user_id: string | null
          sent_at: string
          source: string
          status: string
          subject: string
        }
        SetofOptions: {
          from: "*"
          to: "candidate_outreach"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      send_job_embedding: {
        Args: { job_row: Database["public"]["Tables"]["all_jobs"]["Row"] }
        Returns: Json
      }
      set_company_cancel_at_period_end: {
        Args: { p_cancel: boolean; p_company_id: string }
        Returns: undefined
      }
      set_company_plan: {
        Args: {
          p_actor?: string
          p_company_id: string
          p_note?: string
          p_tier_slug: string
          p_until: string
        }
        Returns: undefined
      }
      sign: {
        Args: { algorithm?: string; payload: Json; secret: string }
        Returns: string
      }
      talent_list_company: { Args: { p_list_id: string }; Returns: string }
      top_skills_search: {
        Args: { "": Database["public"]["Tables"]["user_info"]["Row"] }
        Returns: {
          error: true
        } & "the function public.top_skills_search with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
      }
      try_cast_double: { Args: { inp: string }; Returns: number }
      url_decode: { Args: { data: string }; Returns: string }
      url_encode: { Args: { data: string }; Returns: string }
      verify: {
        Args: { algorithm?: string; secret: string; token: string }
        Returns: {
          header: Json
          payload: Json
          valid: boolean
        }[]
      }
      work_style_preferences_search: {
        Args: { "": Database["public"]["Tables"]["user_info"]["Row"] }
        Returns: {
          error: true
        } & "the function public.work_style_preferences_search with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
      }
    }
    Enums: {
      application_status:
        | "submitted"
        | "reviewed"
        | "selected"
        | "stand_by"
        | "rejected"
      candidate_rating: "strong_no" | "no" | "yes" | "strong_yes"
      job_feedback_vote: "upvote" | "downvote"
      job_posting_matching_status:
        | "pending"
        | "progress"
        | "failed"
        | "completed"
      job_posting_status: "active" | "inactive"
      job_type_enum: "Fulltime" | "Intern" | "Contract"
      payment_status: "complete" | "failed" | "pending" | "cancelled"
      pipeline_stage_kind:
        | "applied"
        | "screening"
        | "interview"
        | "offer"
        | "hired"
        | "rejected"
        | "on_hold"
      screening_recommendation: "strong_yes" | "yes" | "maybe" | "no"
      visa_job_postings: "Will Sponsor" | "Not Required" | "Required"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  pgmq_public: {
    Enums: {},
  },
  public: {
    Enums: {
      application_status: [
        "submitted",
        "reviewed",
        "selected",
        "stand_by",
        "rejected",
      ],
      candidate_rating: ["strong_no", "no", "yes", "strong_yes"],
      job_feedback_vote: ["upvote", "downvote"],
      job_posting_matching_status: [
        "pending",
        "progress",
        "failed",
        "completed",
      ],
      job_posting_status: ["active", "inactive"],
      job_type_enum: ["Fulltime", "Intern", "Contract"],
      payment_status: ["complete", "failed", "pending", "cancelled"],
      pipeline_stage_kind: [
        "applied",
        "screening",
        "interview",
        "offer",
        "hired",
        "rejected",
        "on_hold",
      ],
      screening_recommendation: ["strong_yes", "yes", "maybe", "no"],
      visa_job_postings: ["Will Sponsor", "Not Required", "Required"],
    },
  },
} as const
