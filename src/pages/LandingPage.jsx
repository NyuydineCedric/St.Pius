import Navbar from "../components/NavBar";
import {
  CheckCircle,
  Users,
  Lock,
  FileBox,
  FileBadge,
  Clock12,
  FileCheck,
  Check,
  File,
  Upload,
} from "lucide-react";
import { Link } from "react-router-dom";
import Card from "../components/Card";
import Footer from "../components/Footer";
import teacher from "../assets/teacher.jpg";
import marks from "../assets/marks.jpg";
import report from "../assets/report.jpeg";
import download from "../assets/download.jpg";
import secure from "../assets/secure.jpg";

const LandingPage = () => {
  return (
    <>
      <Navbar />
      <main className="min-h-screen items-center bg-[#e8eef9] justify-center flex flex-col relative  overflow:hidden">
        <div className="absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 49px, rgba(37,99,235, 0.05) 49px, rgba(37,99,235, 0.05) 50px),
                                      repeating-linear-gradient(90deg, transparent, transparent 49px, rgba(37,99,235, 0.05) 49px, rgba(37,99,235, 0.05) 50px)`,
              backgroundSize: "80px 60px",
            }}
          ></div>
        </div>

        {/* HERO */}
        <section id="home" className="relative w-full">
          <div className="relative z-10 min-h-screen items-center flex">
            <div className="mx-auto flex max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-10 lg:py-14">
              <div className="flex w-full flex-col lg:flex-row items-center gap-10 lg:gap-6">
                {/* Left: text content */}
                <div className="flex flex-col items-center lg:items-start text-center lg:text-left lg:w-1/2">
                  <h1 className="text-[40px] sm:text-[45px] md:text-6xl lg:text-7xl max-w-2xl leading-[0.95] tracking-[-0.05em] font-semibold text-[#0F172A] mb-3 text-balance">
                    Smart Report Card
                    <span className="block text-[#2563eb]">
                      Management System
                    </span>
                  </h1>

                  <p className="mt-5 leading-6 text-sm sm:text-base sm:mt-6 sm:leading-7 lg:text-lg text-[#64748B] max-w-xl">
                    Manage student report card securely, efficiently, and
                    digitally. Easy for teachers, accessible for students and
                    reliable for schools
                  </p>

                  <div className="flex w-full sm:w-auto flex-col sm:flex-row mt-4 gap-4 justify-center lg:justify-start">
                    <Link
                      to="/login"
                      className="px-8 py-2 text-center rounded-[4px] bg-[#2563eb] text-white font-semibold hover:bg-blue-600 transition transform hover:scale-105 "
                    >
                      Get Started
                    </Link>
                    <button
                      onClick={() =>
                        document
                          .getElementById("features")
                          .scrollIntoView({ behavior: "smooth" })
                      }
                      className="px-8 py-2 rounded-[4px] cursor-pointer shadow-2xs bg-white text-[#2563eb] transition transform hover:scale-105"
                    >
                      Learn More
                    </button>
                  </div>

                  <div className="mt-8 flex flex-wrap justify-center lg:justify-start gap-6 text-sm text-gray-500">
                    <span className="flex items-center text-[#2563eb] gap-2">
                      <CheckCircle className="w-4 h-4 " />
                      For Administrators & Teachers
                    </span>
                    <span className="flex items-center  text-[#2563eb] gap-2">
                      <CheckCircle className="w-4 h-4" />
                      Accurate & Easy to Use
                    </span>
                    <span className="flex text-[#2563eb] items-center gap-2">
                      <CheckCircle className="w-4 h-4" />
                      Automatic Calculation
                    </span>
                  </div>
                </div>

                {/* Right: hero image */}
                <div className="lg:w-1/2 w-full flex justify-center">
                  <img
                    src={teacher}
                    alt="Teacher reviewing a digital report card on a laptop"
                    style={{ height: "550px" }}
                    className="w-full max-w-md lg:max-w-full rounded-2xl shadow-xl"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ABOUT */}
        <section id="about" className="mt-[-30px]">
          <div className="max-w-6xl gap-8 md:flex w-full mx-auto px-4 py-14 sm:px-6 lg:py-20 lg:px-10">
            <div className="mb-10">
              <h2 className="text-2xl font-semibold tracking-[-0.02em] text-[#2563eb] sm:text-[34px]">
                About us
              </h2>
              <p className="mt-4 sm:text-lg text-base leading-7 sm:leading-8 text-[#64748B] max-w-xl">
                Our report card management system is Built For Schools, Made For
                Educators. Focus more on teaching, and let us handle the
                reportings
              </p>
              <ul className="mt-7 text-[#0F172A] sm:text-[16px] grid sm:grid-cols-2 gap-4">
                <li className="flex items-center gap-2">
                  <Check className="text-[#2563eb] w-4 h-4" />
                  Reduces manual work
                </li>
                <li className="flex items-center gap-2">
                  <Check className="text-[#2563eb] w-4 h-4" />
                  Save time for teachers
                </li>
                <li className="flex items-center gap-2">
                  <Check className="text-[#2563eb] w-4 h-4" />
                  Secure and reliable
                </li>
                <li className="flex items-center gap-2">
                  <Check className="text-[#2563eb] w-4 h-4" />
                  Generate Report card
                </li>
              </ul>
            </div>

            <div className="mt-10 grid md:grid-cols-2 gap-2 items-center justify-center">
              <div className="flex items-start gap-3 p-2 h-25">
                <div
                  className="w-12 h-12 rounded-full p-4 flex justify-center items-center 
                      bg-blue-600/12 shadow-2xs"
                >
                  <div className="text-[#2563eb] text-2xl">
                    <Clock12 />
                  </div>
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-semibold text-[#0F172A] mb-0.5">
                    Saves Time
                  </h3>
                  <p className="text-[#64748B] text-sm">
                    Automate report card generation and reduce manual work
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2 h-25">
                <div
                  className="w-12 h-12 rounded-full p-4 flex justify-center items-center 
                      bg-blue-600/12 shadow-2xs"
                >
                  <div className="text-[#2563eb] text-2xl">
                    <Users />
                  </div>
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-semibold text-[#0F172A] mb-0.5">
                    Easy to use
                  </h3>
                  <p className="text-[#64748B] text-sm">
                    simple and intuitive interface for every teacher
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2 h-25">
                <div
                  className="w-12 h-12 rounded-full p-4 flex justify-center items-center 
                      bg-blue-600/12 shadow-2xs"
                >
                  <div className="text-[#2563eb] text-2xl">
                    <FileCheck />
                  </div>
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-semibold text-[#0F172A] mb-0.5">
                    Accurate Reports
                  </h3>
                  <p className="text-[#64748B] text-sm">
                    Generate accurate <br /> and consistent <br /> reports
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2 h-25">
                <div
                  className="w-12 h-12 rounded-full p-4 flex justify-center items-center 
                      bg-blue-600/12 shadow-2xs"
                >
                  <div className="text-[#2563eb] text-2xl">
                    <File />
                  </div>
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-semibold text-[#0F172A] mb-0.5">
                    Accessible Anywhere
                  </h3>
                  <p className="text-[#64748B] text-sm">
                    Access your data anytime, from any device
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features">
          <div className="max-w-6xl mx-auto px-4 py-14 sm:px-6 lg:py-20 lg:px-10">
            <h2 className="text-2xl font-semibold tracking-[-0.02em] text-center text-[#2563eb] sm:text-[34px]">
              Powerful Features
            </h2>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <Card
                image={marks}
                icon={<FileBox />}
                title="Input Marks Easily"
                text="Add students by class and input marks for each subject"
              />
              <Card
                image={report}
                icon={<FileBadge />}
                title="Generate Report Cards"
                text="Generate professional report cards instantly with one click"
              />
              <Card
                image={download}
                icon={<Upload />}
                title="Download Report Cards"
                text="Download your report cards easily with one click"
              />
              <Card
                image={secure}
                icon={<Lock />}
                title="Secure & Reliable"
                text="Your date is safe and very reliable with secure storage "
              />
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="relative bg-[#e8eef9] w-full">
          <div className="max-w-6xl mx-auto px-4 py-14 sm:px-6 lg:py-20 lg:px-10">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-semibold tracking-[-0.02em] text-[#2563eb] sm:text-[34px]">
                How It Works
              </h2>
              <p className="text-3xl md:text-4xl font-semibold tracking-[-0.02em] text-[#0F172A] max-w-4xl mx-auto">
                Simple steps, Powerful Results
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              <div className="flex items-start gap-3 p-2 border-[#2563eb] border-r h-20">
                <div className="w-10 h-10 mx-auto mb-6 rounded-full bg-[#2563eb] shadow-2xl flex items-center justify-center text-md font-semibold text-white p-4">
                  1
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-semibold text-[#0F172A] mb-0.5">
                    Add Classes & Input Marks
                  </h3>
                  <p className="text-[#64748B] text-sm">
                    Create classes and subject of students then input their
                    marks for each subject
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2 border-[#2563eb] border-r h-20">
                <div className="w-10 h-10 mx-auto mb-6 rounded-full bg-[#2563eb] shadow-2xl flex items-center justify-center text-md font-semibold text-white p-4">
                  2
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-semibold text-[#0F172A] mb-0.5">
                    Generate Report Cards
                  </h3>
                  <p className="text-[#64748B] text-sm">
                    Generate professional report cards instantly with one click.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2 h-20">
                <div className="w-10 h-10 mx-auto mb-6 rounded-full bg-[#2563eb] shadow-2xl flex items-center justify-center text-md font-semibold text-white p-4">
                  3
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-semibold text-[#0F172A] mb-0.5">
                    Export to Excel
                  </h3>
                  <p className="text-[#64748B] text-sm">
                    Export report cards to excel instantly with one click for
                    easy sharing.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="cta ">
          <div className="relative max-w-4xl mx-auto text-center px-4 py-14 sm:px-6 lg:py-16">
            <h2 className="text-2xl sm:text-[34px] font-semibold tracking-[0.02em] text-blue-600">
              Ready to reduce paperwork and save time?
            </h2>
            <p className="mx-auto text-base sm:text-lg text-[#64748B]  max-w-2xl mt-3">
              Join us and start creating report card effortlessly which saves
              time and reduces alot of paperwork
            </p>
            <div className="flex flex-col sm:flex-row mt-4 gap-4 justify-center">
              <Link
                to="/login"
                className="px-8 py-2 text-center rounded-[4px] bg-[#2563eb] text-white font-semibold hover:bg-blue-600 transition transform hover:scale-105 "
              >
                Get Started
              </Link>
              <button
                onClick={() =>
                  document
                    .getElementById("how-it-works")
                    .scrollIntoView({ behavior: "smooth" })
                }
                className="px-8 py-2 rounded-[4px] cursor-pointer shadow-2xs bg-white text-[#2563eb] transition transform hover:scale-105"
              >
                How it Works
              </button>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
};

export default LandingPage;
