import React from "react";
import { Link } from "react-router-dom";
import { BookOpen, Mail, Phone, MessageCircle } from "lucide-react";
import { FacebookIcon, TikTokIcon } from "./SocialIcons";

const CONTACT_EMAIL = "nyuydinecedric@gmail.com";
const CONTACT_PHONE_DISPLAY = "+237 678 772 649";
const CONTACT_WHATSAPP_DIGITS = "237678772649";
const FACEBOOK_URL =
  "https://web.facebook.com/people/Nyuydine-Cedric/100087192623487/";
const TIKTOK_URL =
  "https://www.tiktok.com/@nyuydinecedric?is_from_webapp=1&sender_device=pc";

const Footer = () => {
  return (
    <footer className="py-12 border-t border-white/10 bg-[#2563eb]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-8 mb-8">
          <div className="lg:col-span-1">
            <h3 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              ReportCard
            </h3>
            <p className="text-white/90 text-sm">
              A smart and secure solution for managing student report cards
              efficiently. Built for schools and teachers.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
                className="text-white/90 hover:text-white transition"
              >
                <FacebookIcon size={20} />
              </a>
              <a
                href={TIKTOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TikTok"
                className="text-white/90 hover:text-white transition"
              >
                <TikTokIcon size={20} />
              </a>
              <a
                href={`https://wa.me/${CONTACT_WHATSAPP_DIGITS}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
                className="text-white/90 hover:text-white transition"
              >
                <MessageCircle size={20} />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm text-white/90">
              <li>
                <a href="#home" className="hover:text-white hover:border-b transition">
                  Home
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Resources</h4>
            <ul className="space-y-2 text-sm text-white/90">
              <li>
                <Link to="/user-guide" className="hover:text-white hover:border-b transition">
                  User Guide
                </Link>
              </li>
              <li>
                <Link to="/help" className="hover:text-white hover:border-b transition">
                  Help Center
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-white/90">
              <li>
                <Link to="/privacy" className="hover:text-white hover:border-b transition">
                  Privacy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-white hover:border-b transition">
                  Terms
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Contact</h4>
            <ul className="space-y-2 text-sm text-white/90">
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="flex items-center gap-2 hover:text-white transition"
                >
                  <Mail size={15} />
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li>
                <a
                  href={`tel:+${CONTACT_WHATSAPP_DIGITS}`}
                  className="flex items-center gap-2 hover:text-white transition"
                >
                  <Phone size={15} />
                  {CONTACT_PHONE_DISPLAY}
                </a>
              </li>
              <li>
                <a
                  href={`https://wa.me/${CONTACT_WHATSAPP_DIGITS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 hover:text-white transition"
                >
                  <MessageCircle size={15} />
                  WhatsApp
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="text-center text-white/90 text-sm pt-8 border-t border-white/20">
          <p>&copy; 2026 Report Card Management System. All rights reserved.</p>
          <p className="mt-1 text-white/70">Developed by Nyuydine Cedric</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
