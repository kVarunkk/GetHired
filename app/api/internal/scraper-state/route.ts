import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
const TABLE_NAME = "scraper_state";

export async function GET(req: NextRequest) {
  if (req.headers.get("x-api-key") !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabaseAdmin = createServiceRoleClient();
  const type = req.nextUrl.searchParams.get("type");

  if (!type) {
    return NextResponse.json({ error: "Missing type" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE_NAME)
    .select("newest_company_url,oldest_company_url,historical_scraped_urls")
    .eq("type", type)
    .single();

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json(data, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    },
  });
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-api-key") !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = createServiceRoleClient();
  const body = await req.json();

  const { data, error } = await supabaseAdmin
    .from(TABLE_NAME)
    .upsert(body, {
      onConflict: "type",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json(data, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    },
  });
}

export async function PATCH(req: NextRequest) {
  if (req.headers.get("x-api-key") !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabaseAdmin = createServiceRoleClient();
  const body = await req.json();

  const { type, ...updateData } = body;

  if (!type) {
    return NextResponse.json({ error: "Missing type" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE_NAME)
    .update(updateData)
    .eq("type", type)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json(data, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    },
  });
}
