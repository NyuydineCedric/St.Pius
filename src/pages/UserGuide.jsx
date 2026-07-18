import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Users, PenSquare, FileText, Settings, GraduationCap } from 'lucide-react';

const UserGuide = () => {
  return (
    <div className="min-h-screen bg-[#e8eef9]">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-8">
          <ArrowLeft size={20} />
          Back to Home
        </Link>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <BookOpen className="w-16 h-16 text-blue-600 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-[#1e3a8a]">User Guide</h1>
            <p className="text-gray-600 mt-2">Complete guide to using the Report Card Management System</p>
          </div>

          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <GraduationCap className="text-blue-600" size={24} />
                Getting Started
              </h2>
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-gray-700">
                  Welcome to the School Report Card Management System. This guide will help you 
                  navigate and use all features effectively. The system is designed for both 
                  administrators and teachers.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <Users className="text-blue-600" size={24} />
                For Administrators
              </h2>
              <ul className="space-y-3">
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">1.</span>
                  <div>
                    <h3 className="font-semibold">Student Entry</h3>
                    <p className="text-sm text-gray-600">Add new students, manage their details, and assign to classes.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">2.</span>
                  <div>
                    <h3 className="font-semibold">Marks Entry</h3>
                    <p className="text-sm text-gray-600">Enter marks for students across all subjects and sequences.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">3.</span>
                  <div>
                    <h3 className="font-semibold">Class Management</h3>
                    <p className="text-sm text-gray-600">Create and manage classes, assign class masters.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">4.</span>
                  <div>
                    <h3 className="font-semibold">Settings</h3>
                    <p className="text-sm text-gray-600">Configure school info, staff management, and system preferences.</p>
                  </div>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <PenSquare className="text-blue-600" size={24} />
                For Teachers
              </h2>
              <ul className="space-y-3">
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">1.</span>
                  <div>
                    <h3 className="font-semibold">My Marks Entry</h3>
                    <p className="text-sm text-gray-600">Enter marks only for your assigned classes and subjects.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">2.</span>
                  <div>
                    <h3 className="font-semibold">My Students</h3>
                    <p className="text-sm text-gray-600">View and manage students in your classes.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">3.</span>
                  <div>
                    <h3 className="font-semibold">Report Cards</h3>
                    <p className="text-sm text-gray-600">Generate and print report cards for your students.</p>
                  </div>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <FileText className="text-blue-600" size={24} />
                Report Card Generation
              </h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <ol className="list-decimal list-inside space-y-2 text-gray-700">
                  <li>Navigate to Report Cards section</li>
                  <li>Select a class from the list</li>
                  <li>Choose a student from the roster</li>
                  <li>Select the term and sequence</li>
                  <li>Click "Generate Report Card"</li>
                  <li>Use Print or Download PDF options</li>
                  <li>Use "Print All" to generate report cards for all students</li>
                </ol>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <Settings className="text-blue-600" size={24} />
                Tips & Best Practices
              </h2>
              <ul className="space-y-2 text-gray-700">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Always save marks after entering them
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Use the search functionality to quickly find students
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Generate report cards at the end of each term
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Keep your school information up to date in Settings
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Regularly review the Activities log for system tracking
                </li>
              </ul>
            </section>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
              <h3 className="font-bold text-blue-800 mb-2">Need Help?</h3>
              <p className="text-sm text-gray-700">
                If you need further assistance, please visit our 
                <Link to="/help" className="text-blue-600 hover:underline ml-1">Help Center</Link>
                {" "}or contact your system administrator.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserGuide;