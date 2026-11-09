// Specialty cards for the Publications page. Each card links to the newest free
// full-text articles on PubMed for that field, optionally limited to Africa.
const MEDICINE = [
  ['cardiology', '🫀', 'Cardiologie', 'Cardiology', 'Cardiovascular Diseases'],
  ['pulmonology', '🫁', 'Pneumologie', 'Pulmonology', 'Lung Diseases'],
  ['gastroenterology', '🩺', 'Gastro-entérologie et hépatologie', 'Gastroenterology & hepatology', 'Digestive System Diseases'],
  ['neurology', '🧠', 'Neurologie', 'Neurology', 'Nervous System Diseases'],
  ['nephrology', '💧', 'Néphrologie', 'Nephrology', 'Kidney Diseases'],
  ['endocrinology', '🧪', 'Endocrinologie et diabétologie', 'Endocrinology & diabetes', 'Endocrine System Diseases'],
  ['infectious', '🦠', 'Maladies infectieuses', 'Infectious diseases', 'Communicable Diseases'],
  ['hematology', '🩸', 'Hématologie', 'Haematology', 'Hematologic Diseases'],
  ['oncology', '🎗️', 'Oncologie', 'Oncology', 'Neoplasms'],
  ['pediatrics', '👶', 'Pédiatrie', 'Paediatrics', 'Pediatrics'],
  ['dermatology', '🔬', 'Dermatologie', 'Dermatology', 'Skin Diseases'],
  ['psychiatry', '💭', 'Psychiatrie', 'Psychiatry', 'Mental Disorders'],
  ['rheumatology', '🦴', 'Rhumatologie', 'Rheumatology', 'Rheumatic Diseases'],
  ['internal', '📋', 'Médecine interne', 'Internal medicine', 'Internal Medicine'],
  ['emergency', '🚑', 'Médecine d’urgence', 'Emergency medicine', 'Emergency Medicine'],
  ['public-health', '🌍', 'Santé publique', 'Public health', 'Public Health'],
];

const SURGERY = [
  ['general-surgery', '🏥', 'Chirurgie générale et viscérale', 'General & abdominal surgery', 'General Surgery'],
  ['orthopedics', '🦿', 'Orthopédie et traumatologie', 'Orthopaedics & trauma', 'Orthopedic Procedures'],
  ['neurosurgery', '🧠', 'Neurochirurgie', 'Neurosurgery', 'Neurosurgical Procedures'],
  ['cardiothoracic', '🫀', 'Chirurgie cardio-thoracique', 'Cardiothoracic surgery', 'Thoracic Surgical Procedures'],
  ['vascular', '🩸', 'Chirurgie vasculaire', 'Vascular surgery', 'Vascular Surgical Procedures'],
  ['urology', '💧', 'Urologie', 'Urology', 'Urologic Surgical Procedures'],
  ['obgyn', '🤰', 'Gynécologie-obstétrique', 'Obstetrics & gynaecology', ['Obstetric Surgical Procedures', 'Gynecologic Surgical Procedures']],
  ['pediatric-surgery', '🧸', 'Chirurgie pédiatrique', 'Paediatric surgery', ['Surgical Procedures, Operative', 'Child']],
  ['plastic', '✨', 'Chirurgie plastique et reconstructrice', 'Plastic & reconstructive surgery', 'Plastic Surgery Procedures'],
  ['ent', '👂', 'ORL et chirurgie cervico-faciale', 'ENT / head & neck surgery', 'Otorhinolaryngologic Surgical Procedures'],
  ['ophthalmology', '👁️', 'Ophtalmologie', 'Ophthalmology', 'Ophthalmologic Surgical Procedures'],
  ['maxillofacial', '🦷', 'Chirurgie maxillo-faciale', 'Maxillofacial surgery', 'Surgery, Oral'],
  ['anesthesia', '😷', 'Anesthésie-réanimation', 'Anaesthesia & critical care', 'Anesthesia'],
];

// Child is a filter, not a topic, so pediatric surgery is "surgery AND child"; obgyn is "either procedure type".
function term(mesh) {
  if (!Array.isArray(mesh)) return `"${mesh}"[Majr]`;
  if (mesh[1] === 'Child') return `"${mesh[0]}"[Majr] AND "Child"[Mesh]`;
  return mesh.map((m) => `"${m}"[Majr]`).join(' OR ');
}

function pubmed(query) {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}&filter=simsearch2.ffrft&sort=date`;
}

function card([slug, icon, fr, en, mesh]) {
  const q = term(mesh);
  return { slug, icon, name: { fr, en }, latest: pubmed(q), africa: pubmed(`(${q}) AND "Africa"[Mesh]`) };
}

module.exports = { medicine: MEDICINE.map(card), surgery: SURGERY.map(card), term, pubmed };
