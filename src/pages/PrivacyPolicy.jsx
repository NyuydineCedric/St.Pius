import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, Lock, Eye, Database, CheckCircle, Check } from 'lucide-react';

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-[#e8eef9]">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-8">
          <ArrowLeft size={20} />
          Back to Home
        </Link>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <Shield className="w-16 h-16 text-blue-600 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-[#1e3a8a]">Privacy Policy</h1>
            <p className="text-gray-600 mt-2">Last updated: July 2026</p>
          </div>

          <div className="space-y-6 text-gray-700">
            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-3">
                <Database className="text-blue-600" size={20} />
                Information We Collect
              </h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="mb-3">We collect the following types of information:</p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="text-blue-600 mt-1" size={16} />
                    <span><strong>Personal Information:</strong> Name, email address, phone number</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="text-blue-600 mt-1" size={16} />
                    <span><strong>Student Data:</strong> Academic records, marks, attendance</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="text-blue-600 mt-1" size={16} />
                    <span><strong>School Information:</strong> Institution details, class structures</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="text-blue-600 mt-1" size={16} />
                    <span><strong>Usage Data:</strong> System activity logs, login history</span>
                  </li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-3">
                <Lock className="text-blue-600" size={20} />
                How We Use Your Information
              </h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <ul className="space-y-2">
                  <li className="flex items-start gap-2">
                    <Check className="text-blue-600 font-bold"/>
                    <span>To generate and manage student report cards</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="text-blue-600 font-bold"/>
                    <span>To track academic performance and progress</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="text-blue-600 font-bold"/>
                    <span>To manage teacher assignments and class rosters</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="text-blue-600 font-bold"/>
                    <span>To send notifications and updates</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="text-blue-600 font-bold"/>
                    <span>To improve system performance and user experience</span>
                  </li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] flex items-center gap-2 mb-3">
                <Eye className="text-blue-600" size={20} />
                Data Protection & Security
              </h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <ul className="space-y-2">
                  <li className="flex items-start gap-2">
                    <Check className="text-blue-600 font-bold"/>
                    <span>All data is encrypted in transit using SSL/TLS</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="text-blue-600 font-bold"/>
                    <span>Access is role-based with strict authentication</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="text-blue-600 font-bold"/>
                    <span>Data is stored securely in our database systems</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="text-blue-600 font-bold"/>
                    <span>Regular security audits and updates</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="text-blue-600 font-bold"/>
                    <span>Backup systems ensure data recovery</span>
                  </li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] mb-3">Data Retention</h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <p>
                  We retain your information for as long as your account is active 
                  or as needed to provide services. You can request deletion of 
                  your data at any time by contacting our support team.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] mb-3">Your Rights</h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <ul className="space-y-2">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="text-blue-600 mt-1" size={16} />
                    <span>Access your personal data at any time</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="text-blue-600 mt-1" size={16} />
                    <span>Request corrections to inaccurate data</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="text-blue-600 mt-1" size={16} />
                    <span>Request deletion of your data</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="text-blue-600 mt-1" size={16} />
                    <span>Opt out of communications</span>
                  </li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-[#1e3a8a] mb-3">Contact Us</h2>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="mb-2">
                  If you have any questions about this Privacy Policy, please contact us:
                </p>
                <ul className="space-y-1 text-sm">
                  <li><strong>Email:</strong> bayebrian89@gmail.com</li>
                  <li><strong>Phone:</strong> +237 678772649</li>
                  <li><strong>Phone:</strong> +237 675717944</li>
                </ul>
              </div>
            </section>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200 text-center text-sm text-gray-500">
            <p>SCHOOL Report Card &amp; Information System. All rights reserved.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;