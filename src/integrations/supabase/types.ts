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
      approval_requests: {
        Row: {
          approver_id: string
          collaborator_id: string | null
          comment: string | null
          created_at: string
          decided_at: string | null
          id: string
          payload: Json | null
          request_type: string
          requested_by: string
          status: Database["public"]["Enums"]["approval_status"]
        }
        Insert: {
          approver_id: string
          collaborator_id?: string | null
          comment?: string | null
          created_at?: string
          decided_at?: string | null
          id?: string
          payload?: Json | null
          request_type: string
          requested_by: string
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Update: {
          approver_id?: string
          collaborator_id?: string | null
          comment?: string | null
          created_at?: string
          decided_at?: string | null
          id?: string
          payload?: Json | null
          request_type?: string
          requested_by?: string
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "approvers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      approvers: {
        Row: {
          active: boolean
          created_at: string
          department: string | null
          email: string
          full_name: string
          id: string
          role_title: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          department?: string | null
          email: string
          full_name: string
          id?: string
          role_title: string
        }
        Update: {
          active?: boolean
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          role_title?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      collaborators: {
        Row: {
          active: boolean
          city: string | null
          created_at: string
          full_name: string
          id: string
          role: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          created_at?: string
          full_name: string
          id?: string
          role?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          created_at?: string
          full_name?: string
          id?: string
          role?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cost_logs: {
        Row: {
          amount: number
          billing: Database["public"]["Enums"]["billing_type"]
          client_id: string | null
          collaborator_id: string | null
          cost_type: Database["public"]["Enums"]["cost_type"]
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          period_end: string | null
          period_start: string | null
          project_id: string | null
          vendor_id: string | null
        }
        Insert: {
          amount?: number
          billing?: Database["public"]["Enums"]["billing_type"]
          client_id?: string | null
          collaborator_id?: string | null
          cost_type: Database["public"]["Enums"]["cost_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          project_id?: string | null
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          billing?: Database["public"]["Enums"]["billing_type"]
          client_id?: string | null
          collaborator_id?: string | null
          cost_type?: Database["public"]["Enums"]["cost_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          project_id?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_logs_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_logs_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          collaborator_id: string
          created_at: string
          doc_name: string
          doc_type: string
          expires_at: string
          file_url: string | null
          id: string
          issued_at: string | null
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          doc_name: string
          doc_type: string
          expires_at: string
          file_url?: string | null
          id?: string
          issued_at?: string | null
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          doc_name?: string
          doc_type?: string
          expires_at?: string
          file_url?: string | null
          id?: string
          issued_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      embarkations: {
        Row: {
          client_id: string | null
          collaborator_id: string
          created_at: string
          disembark_date: string | null
          embark_date: string
          id: string
          notes: string | null
          pre_embark_instructions: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["embarkation_status"]
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          collaborator_id: string
          created_at?: string
          disembark_date?: string | null
          embark_date: string
          id?: string
          notes?: string | null
          pre_embark_instructions?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["embarkation_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          collaborator_id?: string
          created_at?: string
          disembark_date?: string | null
          embark_date?: string
          id?: string
          notes?: string | null
          pre_embark_instructions?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["embarkation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "embarkations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embarkations_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embarkations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_bookings: {
        Row: {
          check_in: string
          check_out: string
          collaborator_id: string
          created_at: string
          embarkation_id: string | null
          hotel_name: string
          id: string
          notes: string | null
          vendor_id: string | null
        }
        Insert: {
          check_in: string
          check_out: string
          collaborator_id: string
          created_at?: string
          embarkation_id?: string | null
          hotel_name: string
          id?: string
          notes?: string | null
          vendor_id?: string | null
        }
        Update: {
          check_in?: string
          check_out?: string
          collaborator_id?: string
          created_at?: string
          embarkation_id?: string | null
          hotel_name?: string
          id?: string
          notes?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_bookings_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_bookings_embarkation_id_fkey"
            columns: ["embarkation_id"]
            isOneToOne: false
            referencedRelation: "embarkations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_bookings_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      payroll_summaries: {
        Row: {
          collaborator_id: string
          confirmed_at: string | null
          created_at: string
          cycle_end: string
          cycle_start: string
          days_onboard: number
          id: string
          overtime_hours: number
          sent_at: string | null
          sobreaviso_days: number
          status: Database["public"]["Enums"]["payroll_status"]
          total_hours: number
        }
        Insert: {
          collaborator_id: string
          confirmed_at?: string | null
          created_at?: string
          cycle_end: string
          cycle_start: string
          days_onboard?: number
          id?: string
          overtime_hours?: number
          sent_at?: string | null
          sobreaviso_days?: number
          status?: Database["public"]["Enums"]["payroll_status"]
          total_hours?: number
        }
        Update: {
          collaborator_id?: string
          confirmed_at?: string | null
          created_at?: string
          cycle_end?: string
          cycle_start?: string
          days_onboard?: number
          id?: string
          overtime_hours?: number
          sent_at?: string | null
          sobreaviso_days?: number
          status?: Database["public"]["Enums"]["payroll_status"]
          total_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_summaries_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          embarkation_blocked: boolean
          full_name: string | null
          id: string
          matricula: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          embarkation_blocked?: boolean
          full_name?: string | null
          id: string
          matricula?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          embarkation_blocked?: boolean
          full_name?: string | null
          id?: string
          matricula?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          active: boolean
          client_id: string
          code: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          client_id: string
          code: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          client_id?: string
          code?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      rdo_entries: {
        Row: {
          activity: string
          collaborator_id: string
          created_at: string
          hours: number
          id: string
          observations: string | null
          project_id: string | null
          report_date: string
          status: Database["public"]["Enums"]["rdo_status"]
          updated_at: string
        }
        Insert: {
          activity: string
          collaborator_id: string
          created_at?: string
          hours?: number
          id?: string
          observations?: string | null
          project_id?: string | null
          report_date: string
          status?: Database["public"]["Enums"]["rdo_status"]
          updated_at?: string
        }
        Update: {
          activity?: string
          collaborator_id?: string
          created_at?: string
          hours?: number
          id?: string
          observations?: string | null
          project_id?: string | null
          report_date?: string
          status?: Database["public"]["Enums"]["rdo_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rdo_entries_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rdo_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          activity_type: string
          collaborator_id: string
          created_at: string
          hours: number
          id: string
          project_id: string | null
          reject_comment: string | null
          status: Database["public"]["Enums"]["timesheet_status"]
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          work_date: string
        }
        Insert: {
          activity_type: string
          collaborator_id: string
          created_at?: string
          hours?: number
          id?: string
          project_id?: string | null
          reject_comment?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"]
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          work_date: string
        }
        Update: {
          activity_type?: string
          collaborator_id?: string
          created_at?: string
          hours?: number
          id?: string
          project_id?: string | null
          reject_comment?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"]
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_columns: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: []
      }
      transport_requests: {
        Row: {
          collaborator_id: string
          created_at: string
          destination: string
          driver_name: string | null
          embarkation_id: string | null
          id: string
          notes: string | null
          origin: string
          scheduled_at: string
          status: Database["public"]["Enums"]["transport_status"]
          transport_type: Database["public"]["Enums"]["transport_type"]
          updated_at: string
          vehicle: string | null
          vendor_id: string | null
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          destination: string
          driver_name?: string | null
          embarkation_id?: string | null
          id?: string
          notes?: string | null
          origin: string
          scheduled_at: string
          status?: Database["public"]["Enums"]["transport_status"]
          transport_type: Database["public"]["Enums"]["transport_type"]
          updated_at?: string
          vehicle?: string | null
          vendor_id?: string | null
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          destination?: string
          driver_name?: string | null
          embarkation_id?: string | null
          id?: string
          notes?: string | null
          origin?: string
          scheduled_at?: string
          status?: Database["public"]["Enums"]["transport_status"]
          transport_type?: Database["public"]["Enums"]["transport_type"]
          updated_at?: string
          vehicle?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transport_requests_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_requests_embarkation_id_fkey"
            columns: ["embarkation_id"]
            isOneToOne: false
            referencedRelation: "embarkations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_requests_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      transport_trip_collaborators: {
        Row: {
          collaborator_id: string
          trip_id: string
        }
        Insert: {
          collaborator_id: string
          trip_id: string
        }
        Update: {
          collaborator_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_trip_collaborators_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_trip_collaborators_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "transport_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_trip_tags: {
        Row: {
          tag_id: string
          trip_id: string
        }
        Insert: {
          tag_id: string
          trip_id: string
        }
        Update: {
          tag_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_trip_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "transport_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_trip_tags_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "transport_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_trips: {
        Row: {
          cancelado: boolean
          car_number: string
          column_id: string | null
          created_at: string
          destination: string
          id: string
          notes: string | null
          origin: string
          realizado: boolean
          scheduled_at: string
          updated_at: string
        }
        Insert: {
          cancelado?: boolean
          car_number: string
          column_id?: string | null
          created_at?: string
          destination: string
          id?: string
          notes?: string | null
          origin: string
          realizado?: boolean
          scheduled_at: string
          updated_at?: string
        }
        Update: {
          cancelado?: boolean
          car_number?: string
          column_id?: string | null
          created_at?: string
          destination?: string
          id?: string
          notes?: string | null
          origin?: string
          realizado?: boolean
          scheduled_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_trips_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "transport_columns"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          active: boolean
          contact: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          vendor_type: string | null
        }
        Insert: {
          active?: boolean
          contact?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          vendor_type?: string | null
        }
        Update: {
          active?: boolean
          contact?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          vendor_type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_operator: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "pending" | "collaborator" | "logistics_operator"
      approval_status: "pending" | "approved" | "rejected"
      billing_type: "com_cobranca" | "sem_cobranca"
      cost_type:
        | "transporte_pessoal"
        | "passagem_aerea"
        | "hospedagem"
        | "pre_embarque"
        | "embarque_cancelado"
        | "embarque_transferido"
        | "servico_externo"
        | "demandas_diversas"
      doc_status: "valid" | "expiring" | "expired"
      embarkation_status:
        | "scheduled"
        | "confirmed"
        | "boarded"
        | "disembarked"
        | "cancelled"
        | "transferred"
      payroll_status: "pendente" | "enviado_dp" | "confirmado_dp"
      rdo_status: "draft" | "submitted" | "approved"
      timesheet_status: "draft" | "submitted" | "approved" | "rejected"
      transport_status:
        | "solicitado"
        | "confirmado"
        | "em_transito"
        | "concluido"
        | "cancelado"
      transport_type: "carro" | "van" | "voo" | "onibus"
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
      app_role: ["pending", "collaborator", "logistics_operator"],
      approval_status: ["pending", "approved", "rejected"],
      billing_type: ["com_cobranca", "sem_cobranca"],
      cost_type: [
        "transporte_pessoal",
        "passagem_aerea",
        "hospedagem",
        "pre_embarque",
        "embarque_cancelado",
        "embarque_transferido",
        "servico_externo",
        "demandas_diversas",
      ],
      doc_status: ["valid", "expiring", "expired"],
      embarkation_status: [
        "scheduled",
        "confirmed",
        "boarded",
        "disembarked",
        "cancelled",
        "transferred",
      ],
      payroll_status: ["pendente", "enviado_dp", "confirmado_dp"],
      rdo_status: ["draft", "submitted", "approved"],
      timesheet_status: ["draft", "submitted", "approved", "rejected"],
      transport_status: [
        "solicitado",
        "confirmado",
        "em_transito",
        "concluido",
        "cancelado",
      ],
      transport_type: ["carro", "van", "voo", "onibus"],
    },
  },
} as const
