import {
  INTERNAL_API_SECRET,
  sendEmailForStatusUpdate,
} from "@/utils/serverUtils";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const headersList = await headers();

  const cronSecret = headersList.get("X-Internal-Secret");
  if (cronSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json(
      { message: "Unauthorized access" },
      { status: 401 },
    );
  }

  const { id, email } = await request.json();

  await sendEmailForStatusUpdate(
    `[NEW USER CREATED] New user created with ID: ${id} and Email: ${email}`,
  );
}
