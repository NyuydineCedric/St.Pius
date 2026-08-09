import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Users,
  PenSquare,
  FileText,
  Settings,
  GraduationCap,
  TrendingUp,
  Table,
  ArrowUpCircle,
  Activity,
  CalendarClock,
} from 'lucide-react';

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
                  administrators and teachers, and supports managing multiple academic years from
                  a single account.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <CalendarClock className="text-blue-600" size={24} />
                Academic Years
              </h2>
              <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-gray-700 text-sm">
                <p>
                  The active academic year is set in Settings and controls which year's marks you
                  see and enter throughout the system. Every mark you enter is saved against the
                  academic year that was active at the time.
                </p>
                <p>
                  Switching to a new academic year starts that year with a clean slate for marks —
                  previous years' marks are preserved and never overwritten. To see a past year's
                  marks or report card for a student, use the year selector on the Student Cards
                  page (Student History) or the Mastersheet page.
                </p>
                <p>
                  Because staff assignments are often different each year, starting a new academic
                  year automatically clears existing teacher-to-class/subject assignments — you'll
                  need to reassign teachers in Settings &gt; Staff Management for the new year.
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
                    <p className="text-sm text-gray-600">Add new students, edit their details, and assign them to classes. Use the Edit button on a student row to update their information.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">2.</span>
                  <div>
                    <h3 className="font-semibold">Marks Entry</h3>
                    <p className="text-sm text-gray-600">Enter marks for students across all subjects and CATs (Continuous Assessment Tests) for the active academic year.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">3.</span>
                  <div>
                    <h3 className="font-semibold">Student Cards</h3>
                    <p className="text-sm text-gray-600">Look up an individual student and view their report card for any academic year using the Student History year selector.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">4.</span>
                  <div>
                    <h3 className="font-semibold">Mastersheet</h3>
                    <p className="text-sm text-gray-600">View a whole class's marks in one spreadsheet-style table, for any subject, term, and academic year.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">5.</span>
                  <div>
                    <h3 className="font-semibold">Promotions</h3>
                    <p className="text-sm text-gray-600">At the end of the year, review each class's annual averages and promote qualifying students (annual average ≥ the pass mark) to the next class. Form 3 students moving to Form 4 must be assigned a Science or Arts stream before promotion.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">6.</span>
                  <div>
                    <h3 className="font-semibold">Performance</h3>
                    <p className="text-sm text-gray-600">View class and subject performance analytics — averages, pass rates, and trends across CATs.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">7.</span>
                  <div>
                    <h3 className="font-semibold">Class Management</h3>
                    <p className="text-sm text-gray-600">Create and manage classes and assign class masters.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">8.</span>
                  <div>
                    <h3 className="font-semibold">Settings</h3>
                    <p className="text-sm text-gray-600">Configure school info, the active academic year, staff management, and system preferences.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">9.</span>
                  <div>
                    <h3 className="font-semibold">Activities</h3>
                    <p className="text-sm text-gray-600">View a log of recent actions taken across the system, such as marks entered, students added, and staff changes.</p>
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
                    <p className="text-sm text-gray-600">Enter CAT marks only for your assigned classes and subjects for the active academic year.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600">2.</span>
                  <div>
                    <h3 className="font-semibold">My Students</h3>
                    <p className="text-sm text-gray-600">View and manage students in your assigned classes.</p>
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
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-3 text-sm text-gray-700">
                Note: if a teacher account is removed by an administrator, that teacher immediately
                loses access and can no longer log in to their dashboard.
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <FileText className="text-blue-600" size={24} />
                Report Card Generation
              </h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <ol className="list-decimal list-inside space-y-2 text-gray-700">
                  <li>Navigate to Report Cards (or Student Cards for a single student)</li>
                  <li>Select a class from the list</li>
                  <li>Choose a student from the roster</li>
                  <li>Select the academic year, term, and CAT</li>
                  <li>Click "Generate Report Card"</li>
                  <li>Use Print or Download PDF options</li>
                  <li>Use "Print All" to generate report cards for all students in a class</li>
                </ol>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <Table className="text-blue-600" size={24} />
                Mastersheet
              </h2>
              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700">
                <p>
                  Select a class, subject, and term to view every student's marks across all CATs
                  in a single table. Use the academic year selector to review a past year's
                  mastersheet — this does not affect the current year's data.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <ArrowUpCircle className="text-blue-600" size={24} />
                Promotions
              </h2>
              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 space-y-2">
                <p>
                  From the Promotions page, select a class to preview which students qualify for
                  promotion (annual average at or above the school's pass mark). You can override
                  individual students before confirming.
                </p>
                <p>
                  Students promoted from Form 3 to Form 4 must be assigned a Science or Arts stream
                  during the promotion — this option appears inline for each Form 3 student.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <TrendingUp className="text-blue-600" size={24} />
                Performance
              </h2>
              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700">
                View class and subject-level averages, pass rates, and CAT-by-CAT trends to spot
                where students are struggling or excelling.
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-4">
                <Activity className="text-blue-600" size={24} />
                Activities
              </h2>
              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700">
                The Activities log records key actions across the system — useful for tracking who
                changed what and when.
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
                  Double-check the active academic year before entering marks
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Reassign teachers to classes and subjects at the start of every new academic year
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Run Promotions only after all CATs for the year are fully entered
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
