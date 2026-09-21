import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true
    },
    // The gateway transaction reference this order is tied to (Paystack
    // reference for card/bank payments). Null for Ghana mobile money orders,
    // which don't have a gateway reference.
    paymentReference: {
      type: String,
      default: null
    },
    customerName: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    address: {
      type: String,
      required: true
    },
    items: [
      {
        name: String,
        quantity: Number,
        price: Number,
        productId: mongoose.Schema.Types.ObjectId
      }
    ],
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      enum: ["NGN", "GHS"],
      default: "NGN"
    },
    paymentMethod: {
      type: String,
      default: "Paystack"
    },
        receipt: String,
    receiptPublicId: String,
    receiptOriginalName: String,
    // Populated once a Paystack transaction has actually been verified
    // (either by the automatic /verify flow right after checkout, or by an
    // admin using "Confirm Payment" for an order that got stuck). This is
    // the real record of what Paystack said — not just our own status flag.
    paystackVerification: {
      verifiedAt: Date,
      // "system" = verified automatically right after checkout,
      // "admin" = verified manually via the admin dashboard.
      verifiedBy: String,
      transactionId: mongoose.Schema.Types.Mixed,
      channel: String,
      gatewayResponse: String,
      paidAt: Date
    },
    // Consistent status set used across the app:
    //   Pending Payment       — Paystack order created, awaiting checkout completion
    //   Pending Verification  — Ghana receipt submitted, awaiting admin review
    //   Paid                  — payment confirmed (Paystack-verified or admin-verified)
    //   Completed             — order fulfilled
    //   Cancelled             — order cancelled
    //   Failed                — payment attempt failed/was not verified
    // "Verified", "Processing", and "Delivered" are kept only so existing
    // historical order documents remain valid — no new order is written
    // with these values.
    status: {
      type: String,
      enum: [
        "Pending Payment",
        "Pending Verification",
        "Paid",
        "Verified",
        "Processing",
        "Delivered",
        "Completed",
        "Cancelled",
        "Failed"
      ],
      default: "Pending Verification"
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model("Order", orderSchema);