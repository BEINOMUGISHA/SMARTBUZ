/**
 * SMART_BUZ — the packages for the health businesses.
 *
 * Health: the businesses that look after people's health — a pharmacy, a
 * clinic, a veterinary or agro-clinic.
 */

import type { IndustryPackageDescriptor } from "../types";

/* ────────────────────────────────────────────────────────────────────────
 * Clinic and health centre
 * ──────────────────────────────────────────────────────────────────────── */

const clinic: IndustryPackageDescriptor = {
    key: "clinic",
    label: "Clinic / health centre",
    summary:
        "Runs a clinic list: the patient, the practitioner, the service and the fee, with the patient's own history beside every visit.",
    categoryId: "clinic",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "appointments", "prescriptions", "services", "payroll", "notifications", "imports", "batches", "expiry"],
    features: [
        {
            key: "patient_records",
            label: "Patient records",
            summary:
                "Keep a patient and their history, so the practitioner can see what happened last time.",
            defaultEnabled: true,
        },
        {
            key: "service_catalogue",
            label: "Service catalogue",
            summary:
                "The services the clinic offers and what each one costs.",
            defaultEnabled: true,
        },
        {
            key: "appointments",
            label: "Appointments",
            summary:
                "Book a patient in, and keep the diary for the practitioners.",
            defaultEnabled: true,
        },
        {
            key: "controlled_drugs",
            label: "Controlled drugs",
            summary:
                "A register of controlled substances: what came in, what went out and what should be left.",
            defaultEnabled: false,
        },
        {
            key: "prescriptions",
            label: "Prescriptions",
            summary:
                "Record a prescription with its prescriber and dispense against a batch.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "requirePatientRecord",
            label: "Require a patient record",
            type: "boolean",
            default: true,
            help: "With this on, a visit cannot be recorded without a patient on file.",
        },
        {
            key: "appointmentSlotMinutes",
            label: "Length of an appointment (minutes)",
            type: "number",
            default: 30,
        },
        {
            key: "controlledDrugsEnabled",
            label: "Keep a controlled-drug register",
            type: "boolean",
            default: false,
            help:
                "Turn this on when the clinic holds controlled substances. The register then records what came in and what went out.",
        },
        {
            key: "allowWalkIn",
            label: "Allow walk-in visits",
            type: "boolean",
            default: true,
        },
        {
            key: "receiptRequired",
            label: "Print a receipt for every visit",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "A visit records the patient, the service and the fee. SMARTBUZ does not keep diagnoses, clinical notes or a medical history, and it is not a medical record system.",
        "There is no interaction checking and no dosing validation — SMARTBUZ does not know what one medicine does to another.",
        "The controlled-drug register accounts for quantities. It is not a regulator's register and it does not produce the statutory form.",
        "There is no insurance or scheme billing, no claim submission and no NHIF-style reconciliation.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Veterinary and agro-clinic
 * ──────────────────────────────────────────────────────────────────────── */

const veterinary: IndustryPackageDescriptor = {
    key: "veterinary",
    label: "Veterinary / agro-clinic",
    summary:
        "Treats animals rather than people: a herd record, vaccination campaigns that are tracked animal by animal, and the next dose that falls due.",
    categoryId: "veterinary",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "appointments", "services", "payroll", "notifications", "imports", "pricing"],
    features: [
        {
            key: "animal_records",
            label: "Animal records",
            summary:
                "Keep the animal, its owner and what has been done to it.",
            defaultEnabled: true,
        },
        {
            key: "vaccination_campaigns",
            label: "Vaccination campaigns",
            summary:
                "Bring a herd in, treat the whole batch, and record it on the day.",
            defaultEnabled: true,
        },
        {
            key: "due_dates",
            label: "Next dose due",
            summary:
                "See what is due to be given again, and what was missed.",
            defaultEnabled: true,
        },
        {
            key: "service_tickets",
            label: "Service tickets",
            summary:
                "A call-out, a farm visit or a procedure, with its fee.",
            defaultEnabled: true,
        },
        {
            key: "feed_supply",
            label: "Feed and supplement supply",
            summary:
                "Sell feed alongside the treatment, and take it off the stock.",
            defaultEnabled: false,
        },
    ],
    settings: [
        {
            key: "defaultVaccineLeadDays",
            label: "Warn this many days before a dose is due",
            type: "number",
            default: 14,
        },
        {
            key: "chargePerHead",
            label: "Campaign price is per head",
            type: "boolean",
            default: true,
            help:
                "On, a campaign is priced per animal treated. Off, the campaign carries one price.",
        },
        {
            key: "requireOwnerPhone",
            label: "Require the owner's phone number",
            type: "boolean",
            default: true,
        },
        {
            key: "species",
            label: "Species treated",
            type: "string",
            default: "cattle,poultry,small animals",
            help: "The species the clinic treats, separated by commas.",
        },
    ],
    limitations: [
        "The animal record holds what the clinic was told. It is not a breed-standard, pedigree or production record, and it does not track milk yield or weight gain.",
        "A campaign records the animals treated on the day. There is no mob-splitting plan, no herd book and no individual medicine book.",
        "The due-date list comes from the next-due date entered at the time of the vaccination. SMARTBUZ does not work out a vaccine's own schedule.",
        "There is no clinical record of diagnoses, test results or operative notes.",
    ],
};

export const healthPackages: IndustryPackageDescriptor[] = [clinic, veterinary];
