import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Search, 
  HelpCircle, 
  MessageCircle, 
  Mail, 
  Phone, 
  BookOpen,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

const HelpCenter = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFAQ, setExpandedFAQ] = useState(null);

  const faqs = [
    {
      question: "How do I reset my password?",
      answer: "Click on 'Forgot Password' on the login page. You'll receive a password reset link via email. Follow the instructions to create a new password."
    },
    {
      question: "How do I add a new student?",
      answer: "Navigate to the Student Entry page, fill in the student's details, select their class, and click 'Save Student'. The student will appear in the class roster."
    },
    {
      question: "What is the difference between Admin and Teacher roles?",
      answer: "Admins have full access to all features including settings, staff management, and all student data. Teachers can only access their assigned classes and subjects for marks entry and report generation."
    },
    {
      question: "How do I assign a teacher to a class?",
      answer: "Go to Settings > Staff Management. Select a teacher, choose a class and subject from the dropdowns, and click 'Assign'. The teacher will now appear in the class's teacher list."
    },
    {
      question: "How are report cards generated?",
      answer: "Report cards are automatically generated from the marks entered. Navigate to Report Cards, select a class and student, choose the term, and click 'Generate'. You can then print or download as PDF."
    },
    {
      question: "What does the 'Sequence' mean?",
      answer: "Each academic year is divided into 3 terms, and each term has 2 sequences (e.g., Term 1: Sequence 1 & 2). Marks are recorded per sequence to track student progress throughout the year."
    },
    {
      question: "How do I change the school information?",
      answer: "Go to Settings > School Information. Update the fields and click 'Save Changes'. This information appears on report cards and system headers."
    },
    {
      question: "Can I export data to Excel?",
      answer: "Yes, the Report Cards page allows you to download report cards as PDF files. For data export, you can use the print function and save as PDF for sharing."
    }
  ];

  const filteredFAQs = faqs.filter(faq =>
    faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleFAQ = (index) => {
    setExpandedFAQ(expandedFAQ === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-[#e8eef9]">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-8">
          <ArrowLeft size={20} />
          Back to Home
        </Link>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <HelpCircle className="w-16 h-16 text-blue-600 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-[#1e3a8a]">Help Center</h1>
            <p className="text-gray-600 mt-2">Find answers to common questions and get support</p>
          </div>

          {/* Search */}
          <div className="relative mb-8">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search for help topics..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
            />
          </div>

          {/* Quick Links */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-blue-50 rounded-xl p-4 text-center hover:bg-blue-100 transition cursor-pointer">
              <BookOpen className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <h3 className="font-semibold text-gray-800">User Guide</h3>
              <p className="text-sm text-gray-600">Step-by-step documentation</p>
            </div>
            <div className="bg-green-50 rounded-xl p-4 text-center hover:bg-green-100 transition cursor-pointer">
              <MessageCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <h3 className="font-semibold text-gray-800">Live Chat</h3>
              <p className="text-sm text-gray-600">Chat with support team</p>
            </div>
            <div className="bg-purple-50 rounded-xl p-4 text-center hover:bg-purple-100 transition cursor-pointer">
              <Mail className="w-8 h-8 text-purple-600 mx-auto mb-2" />
              <h3 className="font-semibold text-gray-800">Email Support</h3>
              <p className="text-sm text-gray-600">support@school.edu</p>
            </div>
          </div>

          {/* FAQ Section */}
          <h2 className="text-2xl font-bold text-[#1e3a8a] mb-4">Frequently Asked Questions</h2>
          
          <div className="space-y-3">
            {filteredFAQs.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No results found for "{searchTerm}"</p>
            ) : (
              filteredFAQs.map((faq, index) => (
                <div key={index} className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleFAQ(index)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition"
                  >
                    <span className="font-medium text-gray-800">{faq.question}</span>
                    {expandedFAQ === index ? (
                      <ChevronUp className="text-gray-500" size={20} />
                    ) : (
                      <ChevronDown className="text-gray-500" size={20} />
                    )}
                  </button>
                  {expandedFAQ === index && (
                    <div className="p-4 bg-gray-50 border-t border-gray-200">
                      <p className="text-gray-700">{faq.answer}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Contact Support */}
          <div className="mt-8 bg-gray-50 rounded-xl p-6 border border-gray-200">
            <h3 className="font-bold text-gray-800 mb-3">Still need help?</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <Phone className="text-blue-600" size={20} />
                <div>
                  <p className="text-sm text-gray-600">Phone Support</p>
                  <p className="font-semibold text-gray-800">+237 675717944</p>
                   <p className="font-semibold text-gray-800">+237 678772649</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="text-blue-600" size={20} />
                <div>
                  <p className="text-sm text-gray-600">Email Support</p>
                  <p className="font-semibold text-gray-800">bayebrian89@gmail.com</p>
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-4">
              Support hours: Monday - Friday, 8:00 AM - 5:00 PM
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpCenter;