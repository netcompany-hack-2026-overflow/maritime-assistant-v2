/** Greek labels for values that come from the API as codes. */

export const EVENT_LABEL: Record<string, string> = {
  BERTH_DELAY: "Καθυστέρηση πρόσδεσης",
  CONGESTION: "Συμφόρηση λιμανιού",
  CLOSURE: "Κλείσιμο λιμανιού",
  BUNKER_OFFER: "Προσφορά καυσίμου",
  NONE: "Κανένα συμβάν",
};

export const STATUS_LABEL: Record<string, string> = {
  PENDING: "Σε αναμονή",
  APPROVED: "Εγκρίθηκε",
  REJECTED: "Απορρίφθηκε",
  PLANNED: "Προγραμματισμένο",
  UNDERWAY: "Σε εξέλιξη",
  ARRIVED: "Έφτασε",
  CANCELLED: "Ακυρώθηκε",
  IDLE: "Χωρίς ταξίδι",
};

export { NOT_TAKEN_PREFIX } from "@maritime/shared";
