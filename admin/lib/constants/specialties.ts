export const MEDICAL_SPECIALTIES = [
  // Primary Care
  { id: "general_practice", label: "General Practice / Family Medicine" },
  { id: "internal_medicine", label: "Internal Medicine" },
  { id: "pediatrics", label: "Pediatrics" },
  { id: "geriatrics", label: "Geriatrics" },

  // Surgical
  { id: "general_surgery", label: "General Surgery" },
  { id: "cardiac_surgery", label: "Cardiac Surgery" },
  { id: "neurosurgery", label: "Neurosurgery" },
  { id: "orthopedics", label: "Orthopedics / Traumatology" },
  { id: "plastic_surgery", label: "Plastic Surgery" },
  { id: "vascular_surgery", label: "Vascular Surgery" },
  { id: "thoracic_surgery", label: "Thoracic Surgery" },

  // Medical Specialties
  { id: "cardiology", label: "Cardiology" },
  { id: "pulmonology", label: "Pulmonology" },
  { id: "gastroenterology", label: "Gastroenterology" },
  { id: "hepatology", label: "Hepatology" },
  { id: "endocrinology", label: "Endocrinology / Diabetology" },
  { id: "nephrology", label: "Nephrology" },
  { id: "rheumatology", label: "Rheumatology" },
  { id: "hematology", label: "Hematology" },
  { id: "oncology", label: "Oncology" },
  { id: "neurology", label: "Neurology" },
  { id: "psychiatry", label: "Psychiatry" },
  { id: "dermatology", label: "Dermatology" },
  { id: "allergology", label: "Allergology / Immunology" },
  { id: "infectious_diseases", label: "Infectious Diseases" },

  // Sensory Organs
  { id: "ophthalmology", label: "Ophthalmology" },
  { id: "ent", label: "Otorhinolaryngology (ENT)" },

  // Reproductive
  { id: "gynecology", label: "Gynecology / Obstetrics" },
  { id: "urology", label: "Urology" },

  // Diagnostics & Support
  { id: "radiology", label: "Radiology" },
  { id: "pathology", label: "Pathology" },
  { id: "nuclear_medicine", label: "Nuclear Medicine" },
  { id: "anesthesiology", label: "Anesthesiology" },
  { id: "emergency_medicine", label: "Emergency Medicine" },
  { id: "intensive_care", label: "Intensive Care Medicine" },

  // Rehabilitation & Other
  { id: "physical_medicine", label: "Physical Medicine / Rehabilitation" },
  { id: "sports_medicine", label: "Sports Medicine" },
  { id: "occupational_medicine", label: "Occupational Medicine" },
  { id: "palliative_care", label: "Palliative Care" },
  { id: "clinical_genetics", label: "Clinical Genetics" },
  { id: "neonatology", label: "Neonatology" },

  // Dental
  { id: "dentistry", label: "Dentistry" },
  { id: "oral_surgery", label: "Oral & Maxillofacial Surgery" },
] as const;

export type SpecialtyKey = (typeof MEDICAL_SPECIALTIES)[number]["id"];
