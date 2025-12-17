import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Buffer } from "buffer";
import { client } from "@/lib/dodo/initialize";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { paymentId } = await params;

  if (!paymentId) {
    return NextResponse.json(
      { error: "Missing paymentId in request body." },
      { status: 400 }
    );
  }

  try {
    // Verify that the logged-in user owns this paymentId.
    const { data: paymentRecord, error: dbError } = await supabase
      .from("payments")
      .select("user_id")
      .eq("payment_id", paymentId)
      .eq("user_id", user.id)
      .single();

    if (dbError || !paymentRecord) {
      console.error(
        `Invoice fetch failed for payment ${paymentId}: User ${user.id} does not own it.`
      );
      return NextResponse.json(
        { error: "Invoice not found or access denied." },
        { status: 404 }
      );
    }

    // --- 4. FETCH INVOICE FILE FROM DODO PAYMENTS ---

    // Retrieve the payment object which contains the invoice file access
    const paymentWithInvoice =
      await client.invoices.payments.retrieve(paymentId);

    // Access the invoice file content as a Blob
    const invoiceBlob = await paymentWithInvoice.blob();

    // Convert the Blob to a Node.js Buffer for serving via HTTP
    const arrayBuffer = await invoiceBlob.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // 5. Return the file with correct headers for download
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice_${paymentId}.pdf"`,
        "Content-Length": fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Invoice retrieval failed:", error);
    return NextResponse.json(
      { error: "Failed to retrieve invoice file." },
      { status: 500 }
    );
  }
}
