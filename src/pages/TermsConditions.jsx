import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  FileText,
  CheckSquare,
  AlertTriangle,
  Users,
  Shield,
  XCircle,
} from "lucide-react";

// Reusable bullet list — pass items + a color for the bullet ("blue" or "red")
const BulletList = ({ items, color = "blue" }) => {
  const bulletColor = color === "red" ? "text-red-500" : "text-blue-600";
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-end gap-2">
          <span className={`${bulletColor} text-2xl font-bold`}>.</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
};

// Reusable section wrapper — handles the heading + icon + gray card
const TermsSection = ({ icon: Icon, title, children }) => (
  <section>
    <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-3">
      {Icon && <Icon className="text-blue-600" size={20} />}
      {title}
    </h2>
    <div className="bg-gray-50 rounded-lg p-4">{children}</div>
  </section>
);

// All content lives here — edit text without touching layout code
const userAccountItems = [
  "You must be authorized to use this system",
  "Your account is for educational purposes only",
  "Keep your login credentials confidential",
  "You are responsible for all activities under your account",
  "Report any unauthorized access immediately",
];

const userResponsibilityItems = [
  "Accurately enter and maintain student records",
  "Keep all student data confidential",
  "Use the system only for authorized purposes",
  "Respect the intellectual property of the system",
  "Not attempt to disrupt or compromise system security",
];

const prohibitedItems = [
  "Accessing data without proper authorization",
  "Tampering with system functionality",
  "Uploading malicious content or viruses",
  "Attempting to bypass security measures",
  "Sharing sensitive data with unauthorized parties",
];

const TermsConditions = () => {
  return (
    <div className="min-h-screen bg-[#e8eef9]">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-8"
        >
          <ArrowLeft size={20} />
          Back to Home
        </Link>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <FileText className="w-16 h-16 text-blue-600 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-[#1e3a8a]">
              Terms & Conditions
            </h1>
            <p className="text-gray-600 mt-2">Last updated: July 2026</p>
          </div>

          <div className="space-y-6 text-gray-700">
            <TermsSection icon={CheckSquare} title="Acceptance of Terms">
              <p>
                By using the School Report Card Management System, you agree to
                these Terms and Conditions. If you do not agree to these terms,
                please do not use our services.
              </p>
            </TermsSection>

            <TermsSection icon={Users} title="User Accounts">
              <BulletList items={userAccountItems} />
            </TermsSection>

            <TermsSection icon={Shield} title="User Responsibilities">
              <BulletList items={userResponsibilityItems} />
            </TermsSection>

            <TermsSection icon={AlertTriangle} title="Data Accuracy">
              <p>
                You are responsible for ensuring that all data entered into the
                system is accurate and up-to-date. The system provides features
                for data validation, but final verification rests with the user.
              </p>
            </TermsSection>

            <TermsSection icon={XCircle} title="Prohibited Activities">
              <BulletList items={prohibitedItems} color="red" />
            </TermsSection>

            <TermsSection title="Intellectual Property">
              <p>
                The School Report Card System, including its design, code, and
                content, is protected by copyright and intellectual property
                laws. You may not copy, modify, distribute, or reverse-engineer
                any part of the system without explicit permission.
              </p>
            </TermsSection>

            <TermsSection title="Termination">
              <p>
                We reserve the right to suspend or terminate accounts that
                violate these terms or are used for unauthorized purposes. Users
                will be notified of any termination and may appeal the decision.
              </p>
            </TermsSection>

            <TermsSection title="Limitation of Liability">
              <p>
                The system is provided "as is" without warranties of any kind.
                While we strive for accuracy and reliability, we are not liable
                for errors, omissions, or interruptions in service. Users are
                responsible for backing up their own data.
              </p>
            </TermsSection>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
              <h3 className="font-bold text-blue-800 mb-2">Questions?</h3>
              <p className="text-sm text-gray-700">
                If you have questions about these Terms & Conditions, please
                contact us at
                <strong> nyuydinecedric@gmail.com</strong> or call/WhatsApp
                <strong> +237 678 772 649</strong>.
              </p>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200 text-center text-sm text-gray-500">
            <p>
              SCHOOL Report Card &amp; Information System. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TermsConditions;
