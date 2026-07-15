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
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          created_at?: string
          full_name: string
          id?: string
          role?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          created_at?: string
          full_name?: string
          id?: string
          role?: string | null
          unit?: string | null
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
      hist_novo_colaboradores: {
        Row: {
          created_at: string
          empresa: string | null
          funcao: string | null
          funcao_operacao: string | null
          id: string
          matricula: string
          nome: string
        }
        Insert: {
          created_at?: string
          empresa?: string | null
          funcao?: string | null
          funcao_operacao?: string | null
          id?: string
          matricula: string
          nome: string
        }
        Update: {
          created_at?: string
          empresa?: string | null
          funcao?: string | null
          funcao_operacao?: string | null
          id?: string
          matricula?: string
          nome?: string
        }
        Relationships: []
      }
      hist_novo_periodos: {
        Row: {
          bsp: string | null
          centro_de_custo: string | null
          colaborador_id: string
          created_at: string
          data_fim: string
          data_inicio: string
          dias: number | null
          id: string
          origem: string | null
          tipo: string
          unidade_operacional: string | null
        }
        Insert: {
          bsp?: string | null
          centro_de_custo?: string | null
          colaborador_id: string
          created_at?: string
          data_fim: string
          data_inicio: string
          dias?: number | null
          id?: string
          origem?: string | null
          tipo: string
          unidade_operacional?: string | null
        }
        Update: {
          bsp?: string | null
          centro_de_custo?: string | null
          colaborador_id?: string
          created_at?: string
          data_fim?: string
          data_inicio?: string
          dias?: number | null
          id?: string
          origem?: string | null
          tipo?: string
          unidade_operacional?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hist_novo_periodos_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "hist_novo_colaboradores"
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
      materials: {
        Row: {
          active: boolean
          categoria: string | null
          code: string | null
          created_at: string
          descricao: string | null
          id: string
          qtd: number
          updated_at: string
          volume: string | null
        }
        Insert: {
          active?: boolean
          categoria?: string | null
          code?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          qtd?: number
          updated_at?: string
          volume?: string | null
        }
        Update: {
          active?: boolean
          categoria?: string | null
          code?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          qtd?: number
          updated_at?: string
          volume?: string | null
        }
        Relationships: []
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
          code: string | null
          created_at: string
          email: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          client_id: string
          code?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          client_id?: string
          code?: string | null
          created_at?: string
          email?: string | null
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
      timesheet_embarques: {
        Row: {
          bsp: string | null
          colaborador_id: string
          criado_em: string
          data_fim_embarque: string
          data_inicio_embarque: string
          funcao_embarque: string
          id: string
          periodo_id: string | null
          status_entrega: string
          unidade_operacional: string | null
        }
        Insert: {
          bsp?: string | null
          colaborador_id: string
          criado_em?: string
          data_fim_embarque: string
          data_inicio_embarque: string
          funcao_embarque: string
          id?: string
          periodo_id?: string | null
          status_entrega?: string
          unidade_operacional?: string | null
        }
        Update: {
          bsp?: string | null
          colaborador_id?: string
          criado_em?: string
          data_fim_embarque?: string
          data_inicio_embarque?: string
          funcao_embarque?: string
          id?: string
          periodo_id?: string | null
          status_entrega?: string
          unidade_operacional?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_embarques_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "hist_novo_colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_embarques_periodo_id_fkey"
            columns: ["periodo_id"]
            isOneToOne: false
            referencedRelation: "hist_novo_periodos"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_semanas: {
        Row: {
          criado_em: string
          data_fim_semana: string
          data_inicio_semana: string
          data_recebimento: string | null
          embarque_id: string
          id: string
          recebido_fisico: boolean
        }
        Insert: {
          criado_em?: string
          data_fim_semana: string
          data_inicio_semana: string
          data_recebimento?: string | null
          embarque_id: string
          id?: string
          recebido_fisico?: boolean
        }
        Update: {
          criado_em?: string
          data_fim_semana?: string
          data_inicio_semana?: string
          data_recebimento?: string | null
          embarque_id?: string
          id?: string
          recebido_fisico?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_semanas_embarque_id_fkey"
            columns: ["embarque_id"]
            isOneToOne: false
            referencedRelation: "timesheet_embarques"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_dias: {
        Row: {
          adicional_noturno: boolean
          criado_em: string
          data: string
          descricao_tarefa: string | null
          dia_semana: string
          evento: string | null
          feriado: boolean
          hora_entrada: string | null
          hora_entrada_extra: string | null
          hora_saida: string | null
          hora_saida_extra: string | null
          horas_extras: number | null
          horas_normais: number | null
          id: string
          numero_tarefa: string | null
          semana_id: string
          total_horas: number | null
        }
        Insert: {
          adicional_noturno?: boolean
          criado_em?: string
          data: string
          descricao_tarefa?: string | null
          dia_semana: string
          evento?: string | null
          feriado?: boolean
          hora_entrada?: string | null
          hora_entrada_extra?: string | null
          hora_saida?: string | null
          hora_saida_extra?: string | null
          horas_extras?: number | null
          horas_normais?: number | null
          id?: string
          numero_tarefa?: string | null
          semana_id: string
          total_horas?: number | null
        }
        Update: {
          adicional_noturno?: boolean
          criado_em?: string
          data?: string
          descricao_tarefa?: string | null
          dia_semana?: string
          evento?: string | null
          feriado?: boolean
          hora_entrada?: string | null
          hora_entrada_extra?: string | null
          hora_saida?: string | null
          hora_saida_extra?: string | null
          horas_extras?: number | null
          horas_normais?: number | null
          id?: string
          numero_tarefa?: string | null
          semana_id?: string
          total_horas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_dias_semana_id_fkey"
            columns: ["semana_id"]
            isOneToOne: false
            referencedRelation: "timesheet_semanas"
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
      transport_trip_materials: {
        Row: {
          material_id: string
          quantidade: number | null
          trip_id: string
        }
        Insert: {
          material_id: string
          quantidade?: number | null
          trip_id: string
        }
        Update: {
          material_id?: string
          quantidade?: number | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_trip_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_trip_materials_trip_id_fkey"
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
          arrival_time: string | null
          bsp: string | null
          bsp_2: string | null
          bsp_3: string | null
          cancelado: boolean
          car_number: string
          cliente: string | null
          cliente_2: string | null
          cliente_3: string | null
          column_id: string | null
          created_at: string
          departure_time: string | null
          destination: string
          destinos_extras: string[]
          id: string
          notes: string | null
          origens_extras: string[]
          origin: string
          realizado: boolean
          scheduled_at: string
          status: Database["public"]["Enums"]["transport_trip_status"]
          tipo: Database["public"]["Enums"]["transport_tipo"]
          unidade: string | null
          updated_at: string
        }
        Insert: {
          arrival_time?: string | null
          bsp?: string | null
          bsp_2?: string | null
          bsp_3?: string | null
          cancelado?: boolean
          car_number: string
          cliente?: string | null
          cliente_2?: string | null
          cliente_3?: string | null
          column_id?: string | null
          created_at?: string
          departure_time?: string | null
          destination: string
          destinos_extras?: string[]
          id?: string
          notes?: string | null
          origens_extras?: string[]
          origin: string
          realizado?: boolean
          scheduled_at: string
          status?: Database["public"]["Enums"]["transport_trip_status"]
          tipo?: Database["public"]["Enums"]["transport_tipo"]
          unidade?: string | null
          updated_at?: string
        }
        Update: {
          arrival_time?: string | null
          bsp?: string | null
          bsp_2?: string | null
          bsp_3?: string | null
          cancelado?: boolean
          car_number?: string
          cliente?: string | null
          cliente_2?: string | null
          cliente_3?: string | null
          column_id?: string | null
          created_at?: string
          departure_time?: string | null
          destination?: string
          destinos_extras?: string[]
          id?: string
          notes?: string | null
          origens_extras?: string[]
          origin?: string
          realizado?: boolean
          scheduled_at?: string
          status?: Database["public"]["Enums"]["transport_trip_status"]
          tipo?: Database["public"]["Enums"]["transport_tipo"]
          unidade?: string | null
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
      nominations: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          pm_user_id: string | null
          pm_name: string
          project: string | null
          client: string | null
          function_requested: string
          weld_type: string | null
          period_start: string
          period_end: string
          notes: string | null
          current_status: string
          requires_quality_validation: boolean
          requires_superior_approval: boolean
          approved_collaborator_name: string | null
          approved_collaborator_id: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          updated_at?: string
          pm_user_id?: string | null
          pm_name: string
          project?: string | null
          client?: string | null
          function_requested: string
          weld_type?: string | null
          period_start: string
          period_end: string
          notes?: string | null
          current_status?: string
          requires_quality_validation?: boolean
          requires_superior_approval?: boolean
          approved_collaborator_name?: string | null
          approved_collaborator_id?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          updated_at?: string
          pm_user_id?: string | null
          pm_name?: string
          project?: string | null
          client?: string | null
          function_requested?: string
          weld_type?: string | null
          period_start?: string
          period_end?: string
          notes?: string | null
          current_status?: string
          requires_quality_validation?: boolean
          requires_superior_approval?: boolean
          approved_collaborator_name?: string | null
          approved_collaborator_id?: string | null
        }
        Relationships: []
      }
      nomination_status_history: {
        Row: {
          id: string
          nomination_id: string
          status: string
          changed_by_name: string
          changed_at: string
          notes: string | null
        }
        Insert: {
          id?: string
          nomination_id: string
          status: string
          changed_by_name: string
          changed_at?: string
          notes?: string | null
        }
        Update: {
          id?: string
          nomination_id?: string
          status?: string
          changed_by_name?: string
          changed_at?: string
          notes?: string | null
        }
        Relationships: []
      }
      transport_solicitations: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          user_id: string | null
          solicitante: string
          setor: string
          centro_custo: string
          data_hora: string
          origem: string | null
          destino: string | null
          tipos_transporte: string[]
          status: string
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          updated_at?: string
          user_id?: string | null
          solicitante: string
          setor: string
          centro_custo: string
          data_hora: string
          origem?: string | null
          destino?: string | null
          tipos_transporte?: string[]
          status?: string
          notes?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          updated_at?: string
          user_id?: string | null
          solicitante?: string
          setor?: string
          centro_custo?: string
          data_hora?: string
          origem?: string | null
          destino?: string | null
          tipos_transporte?: string[]
          status?: string
          notes?: string | null
        }
        Relationships: []
      }
      weld_type_config: {
        Row: {
          id: string
          weld_type_name: string
          requires_quality_validation: boolean
          created_at: string
        }
        Insert: {
          id?: string
          weld_type_name: string
          requires_quality_validation?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          weld_type_name?: string
          requires_quality_validation?: boolean
          created_at?: string
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
      app_role: "pending" | "collaborator" | "logistics_operator" | "pm"
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
      transport_tipo: "pessoas" | "material"
      transport_trip_status: "em_andamento" | "realizado" | "cancelado"
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
      app_role: ["pending", "collaborator", "logistics_operator", "pm"],
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
      transport_tipo: ["pessoas", "material"],
      transport_trip_status: ["em_andamento", "realizado", "cancelado"],
      transport_type: ["carro", "van", "voo", "onibus"],
    },
  },
} as const
