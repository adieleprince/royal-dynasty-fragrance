import express from "express";
import Order from "../models/order.model.js";
import { resolveOrderItems } from "../utils/orderPricing.js";
import { sendOrderEmail } from "../config/email.js";
import { orderConfirmationEmail } from "../email-templates/index.js";
import { isValidEmail, sanitizeText } from "../utils/validation.js";
import { orderCreationLimiter } from "../middleware/rateLimit.middleware.js";
import { authenticate, requireAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_CALLBACK_URL = process.env.PAYSTACK_CALLBACK_URL;

function makeReference() {
  return `rdf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// Paystack can be configured so the customer bears Paystack's own
// transaction fee, in which case the amount actually charged (and
// returned by verify) is a bit higher than what we sent at initialize.
// A real payment should never be rejected just because the customer also
// paid Paystack's fee on top of the order total — only a payment for LESS
// than the order is an actual problem. We accept anything from the exact
// expected amount up to a generous 6% ceiling (comfortably covers
// Paystack's published fee schedules), so a badly wrong order.amount
// still can't silently wave through an unrelated, much larger payment.
function paystackAmountCoversOrder(paystackAmountSubunit, expectedSubunit) {
  if (!Number.isFinite(paystackAmountSubunit) || !Number.isFinite(expectedSubunit)) return false;
  const maxAcceptable = Math.round(expectedSubunit * 1.06);
  return paystackAmountSubunit >= expectedSubunit && paystackAmountSubunit <= maxAcceptable;
}

// =========================================
// INITIALIZE PAYMENT
// The cart is validated against our own product/bundle catalog here —
// the amount and item prices the client sends are never trusted. An order
// is created immediately with status "Pending Payment", using the Paystack
// reference as its orderId, before Paystack is asked to start the
// transaction. This gives every payment attempt a real, traceable order
// record and makes the reference the natural key for idempotency.
// =========================================
router.post("/initialize", orderCreationLimiter, async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        message: "Payments are not configured on the server."
      });
    }

    const customerName = sanitizeText(req.body.customerName, 150);
    const phone = sanitizeText(req.body.phone, 40);
    const email = sanitizeText(req.body.email, 200).toLowerCase();
    const address = sanitizeText(req.body.address, 500);
    const { currency, items } = req.body;

    if (!customerName || !phone || !email || !address) {
      return res.status(400).json({
        success: false,
        message: "Full name, phone, email, and address are required."
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address."
      });
    }

    const pricing = await resolveOrderItems(items, currency);
    if (!pricing.ok) {
      return res.status(400).json({ success: false, message: pricing.message });
    }

    const reference = makeReference();

    let order;
    try {
      order = await Order.create({
        orderId: reference,
        paymentReference: reference,
        customerName,
        phone,
        email,
        address,
        items: pricing.items,
        amount: pricing.amount,
        currency: pricing.currency,
        paymentMethod: "Paystack",
        status: "Pending Payment"
      });
    } catch (dbError) {
      console.error("ORDER CREATE ERROR (initialize):", dbError);
      return res.status(500).json({
        success: false,
        message: "Could not start your order. Please try again."
      });
    }

    const amountInSubunit = Math.round(pricing.amount * 100);

    let paystackResponse;
    try {
      paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          amount: amountInSubunit,
          currency: pricing.currency,
          reference,
          callback_url: PAYSTACK_CALLBACK_URL
        })
      });
    } catch (networkError) {
      console.error("PAYSTACK NETWORK ERROR:", networkError);
      await Order.findByIdAndDelete(order._id);
      return res.status(502).json({
        success: false,
        message: "Could not reach the payment provider. Please try again."
      });
    }

    const data = await paystackResponse.json();

    if (!paystackResponse.ok || !data.status) {
      // Paystack rejected the request outright, so no real payment attempt
      // ever started — remove the order rather than leaving a dead record.
      await Order.findByIdAndDelete(order._id);
      return res.status(400).json({
        success: false,
        message: data.message || "Failed to initialize payment"
      });
    }

    return res.status(200).json({
      success: true,
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference
    });
  } catch (error) {
    console.error("PAYSTACK INITIALIZE ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Could not initialize payment"
    });
  }
});

// =========================================
// VERIFY PAYMENT
// Called by the frontend once Paystack redirects the customer back. The
// backend is the only party trusted to decide whether payment succeeded —
// it verifies directly with Paystack and cross-checks the amount/currency
// against the order created at initialize time. Safe to call more than
// once for the same reference: already-finalized orders are returned
// as-is rather than re-verified or duplicated.
//
// This route intentionally does NOT re-check Paystack for an order that's
// already left "Pending Payment" (including "Failed") — that's what the
// admin-only /admin-verify route below is for. Keeping this one narrow
// avoids ever re-triggering a duplicate confirmation email from an
// ordinary page reload/retry.
// =========================================
router.get("/verify/:reference", async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        message: "Payments are not configured on the server."
      });
    }

    const { reference } = req.params;

    const order = await Order.findOne({ orderId: reference });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "We couldn't find an order for this payment reference."
      });
    }

    // Already finalized — don't re-verify with Paystack or touch the order
    // again. This is what prevents a duplicate order/duplicate email if the
    // frontend calls verify more than once for the same reference.
    if (order.status !== "Pending Payment") {
      return res.status(200).json({
        success: order.status === "Paid",
        alreadyProcessed: true,
        order
      });
    }

    let paystackResponse;
    try {
      paystackResponse = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        }
      );
    } catch (networkError) {
      console.error("PAYSTACK VERIFY NETWORK ERROR:", networkError);
      return res.status(502).json({
        success: false,
        message: "Could not reach the payment provider to verify this payment."
      });
    }

    const data = await paystackResponse.json();
    const txn = data?.data;

    const paystackSaysSuccess =
      paystackResponse.ok && data?.status === true && txn?.status === "success";

    // Cross-check what Paystack says was actually charged against what we
    // expect for this order, so a tampered request can't slip a lower
    // amount or different currency past us.
    const expectedSubunit = Math.round(order.amount * 100);
    const amountMatches = paystackSaysSuccess && paystackAmountCoversOrder(Number(txn.amount), expectedSubunit);
    const currencyMatches = paystackSaysSuccess && txn.currency === order.currency;

    if (paystackSaysSuccess && amountMatches && currencyMatches) {
      // Atomic, status-guarded update: if two verify calls race each other,
      // only one of them will actually flip the status and send the email.
      const updatedOrder = await Order.findOneAndUpdate(
        { _id: order._id, status: "Pending Payment" },
        {
          status: "Paid",
          paystackVerification: {
            verifiedAt: new Date(),
            verifiedBy: "system",
            transactionId: txn.id,
            channel: txn.channel,
            gatewayResponse: txn.gateway_response,
            paidAt: txn.paid_at
          }
        },
        { new: true }
      );

      if (!updatedOrder) {
        const current = await Order.findById(order._id);
        return res.status(200).json({
          success: current?.status === "Paid",
          alreadyProcessed: true,
          order: current
        });
      }

      try {
        const emailContent = orderConfirmationEmail(updatedOrder);
        await sendOrderEmail({
          to: updatedOrder.email,
          subject: emailContent.subject,
          html: emailContent.html,
          adminSubject: `[NEW ORDER - PAID] ${emailContent.subject}`
        });
      } catch (emailError) {
        console.error("ORDER CONFIRMATION EMAIL ERROR:", emailError);
        // Don't fail the response if the email fails to send.
      }

      return res.status(200).json({ success: true, order: updatedOrder });
    }

    // Payment did not succeed, or didn't match what we expected — mark it
    // Failed rather than leaving it stuck as pending forever. If Paystack
    // later shows this reference as successful (e.g. a mobile money payment
    // that settled a few seconds after this check ran), an admin can
    // recover it with "Confirm Payment" in the dashboard, which calls
    // /admin-verify below and re-checks Paystack directly.
    order.status = "Failed";
    await order.save();

    const customerMessage = txn?.gateway_response
      ? `Payment was not completed: ${txn.gateway_response}`
      : "Payment could not be verified.";

    return res.status(200).json({
      success: false,
      message: customerMessage,
      order
    });
  } catch (error) {
    console.error("PAYSTACK VERIFY ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Could not verify payment"
    });
  }
});

// =========================================
// ADMIN: MANUALLY RE-VERIFY A PAYSTACK PAYMENT
// Recovery path for an order stuck as "Pending Payment" or "Failed" even
// though Paystack shows the transaction as successful (e.g. the automatic
// /verify call above ran before Paystack had fully settled the
// transaction). Unlike /verify, this deliberately DOES re-check orders
// that already have a terminal status — that's the whole point of a
// manual recovery path. It still never trusts anything except a fresh,
// direct Paystack verification call: the admin button can only request a
// check, it cannot mark an order Paid on its own.
// =========================================
router.post("/admin-verify/:reference", authenticate, requireAdmin, async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        message: "Payments are not configured on the server."
      });
    }

    const { reference } = req.params;

    const order = await Order.findOne({
      $or: [{ orderId: reference }, { paymentReference: reference }]
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "We couldn't find an order for this payment reference."
      });
    }

    if (order.status === "Paid" || order.status === "Completed") {
      return res.status(200).json({
        success: true,
        alreadyProcessed: true,
        message: "This order is already marked as paid.",
        order
      });
    }

    let paystackResponse;
    try {
      paystackResponse = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        }
      );
    } catch (networkError) {
      console.error("PAYSTACK ADMIN-VERIFY NETWORK ERROR:", networkError);
      return res.status(502).json({
        success: false,
        message: "Could not reach Paystack to verify this payment."
      });
    }

    const data = await paystackResponse.json();
    const txn = data?.data;

    const paystackSaysSuccess =
      paystackResponse.ok && data?.status === true && txn?.status === "success";

    // Same amount/currency cross-check as the automatic flow — an admin
    // click can never mark an order Paid based on status alone.
    const expectedSubunit = Math.round(order.amount * 100);
    const amountMatches = paystackSaysSuccess && paystackAmountCoversOrder(Number(txn.amount), expectedSubunit);
    const currencyMatches = paystackSaysSuccess && txn.currency === order.currency;

    if (!paystackSaysSuccess || !amountMatches || !currencyMatches) {
      return res.status(200).json({
        success: false,
        message: "Payment could not be verified with Paystack.",
        order
      });
    }

    // Atomic, status-guarded update — protects against double-clicking the
    // button, or racing with the automatic /verify call, sending a
    // duplicate confirmation email.
    const updatedOrder = await Order.findOneAndUpdate(
      { _id: order._id, status: { $ne: "Paid" } },
      {
        status: "Paid",
        paymentReference: txn.reference,
        paystackVerification: {
          verifiedAt: new Date(),
          verifiedBy: "admin",
          transactionId: txn.id,
          channel: txn.channel,
          gatewayResponse: txn.gateway_response,
          paidAt: txn.paid_at
        }
      },
      { new: true }
    );

    if (!updatedOrder) {
      const current = await Order.findById(order._id);
      return res.status(200).json({
        success: true,
        alreadyProcessed: true,
        message: "This order was already marked as paid.",
        order: current
      });
    }

    try {
      const emailContent = orderConfirmationEmail(updatedOrder);
      await sendOrderEmail({
        to: updatedOrder.email,
        subject: emailContent.subject,
        html: emailContent.html,
        adminSubject: `[PAYMENT CONFIRMED BY ADMIN] ${emailContent.subject}`
      });
    } catch (emailError) {
      console.error("ADMIN-VERIFY CONFIRMATION EMAIL ERROR:", emailError);
      // Don't fail the request if the email fails to send — the order is
      // already correctly marked Paid at this point.
    }

    return res.status(200).json({ success: true, order: updatedOrder });
  } catch (error) {
    console.error("PAYSTACK ADMIN-VERIFY ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Could not verify this payment. Please try again."
    });
  }
});

export default router;