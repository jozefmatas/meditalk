import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import type {
  Encounter,
  EncounterListParams,
  EncounterStatus,
  CreateEncounterRequest,
} from "@/lib/types";

/** Normalize legacy DB statuses to current values */
function normalizeStatus(status: string): EncounterStatus {
  if (status === "draft") return "started";
  if (status === "review") return "to_review";
  if (status === "closed" || status === "completed") return "completed";
  return status as EncounterStatus;
}

/**
 * GET /api/encounters
 * List user's encounters with pagination
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, supabase } = await requireAuth();

    const searchParams = request.nextUrl.searchParams;
    const params: EncounterListParams = {
      page: parseInt(searchParams.get("page") || "1"),
      limit: Math.min(parseInt(searchParams.get("limit") || "10"), 50),
      status: (searchParams.get("status") as EncounterStatus) || undefined,
      search: searchParams.get("search") || undefined,
      sortBy:
        (searchParams.get("sortBy") as EncounterListParams["sortBy"]) ||
        "visit_date",
      sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
    };

    const offset = (params.page! - 1) * params.limit!;

    // Build query
    let query = supabase
      .from("visits")
      .select("*", { count: "exact" })
      .eq("user_id", userId);

    // Filter by status (exclude archived by default)
    if (params.status) {
      query = query.eq("status", params.status);
    } else {
      query = query.neq("status", "archived");
    }

    // Search by title or patient name
    if (params.search) {
      query = query.or(
        `title.ilike.%${params.search}%,patient_name.ilike.%${params.search}%`,
      );
    }

    // Sort
    query = query.order(params.sortBy!, {
      ascending: params.sortOrder === "asc",
    });

    // Paginate
    query = query.range(offset, offset + params.limit! - 1);

    const { data: visits, error, count } = await query;

    if (error) {
      console.error("Error fetching visits:", error);
      return NextResponse.json(
        { error: "Failed to fetch visits" },
        { status: 500 },
      );
    }

    const normalized = (visits as Encounter[]).map((v) => ({
      ...v,
      status: normalizeStatus(v.status),
    }));

    return NextResponse.json({
      encounters: normalized,
      total: count || 0,
      page: params.page,
      limit: params.limit,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Visits list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/encounters
 * Create a new encounter
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, supabase } = await requireAuth();

    const body: CreateEncounterRequest = await request.json();

    const { data: visit, error } = await supabase
      .from("visits")
      .insert({
        user_id: userId,
        title: body.title || null,
        patient_name: body.patient_name || null,
        patient_id: body.patient_id || null,
        visit_type: body.visit_type || "consultation",
        visit_date: body.visit_date || new Date().toISOString(),
        language: body.language || "sk",
        status: "started",
        metadata: body.metadata || {},
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating visit:", error);
      return NextResponse.json(
        { error: "Failed to create visit" },
        { status: 500 },
      );
    }

    return NextResponse.json(visit, { status: 201 });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Visit creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
