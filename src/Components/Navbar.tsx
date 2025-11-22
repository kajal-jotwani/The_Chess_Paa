'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, User, LogOut, Gamepad2 } from 'lucide-react';
import Image from 'next/image';
import Button from '@/Components/ui/Button';
import { USER_PROFILE } from '../app/constants';

const Navbar: React.FC = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close dropdowns when route changes
  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsProfileOpen(false);
  }, [pathname]);

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Know Your Pieces', path: '/#pieces' },
    { name: 'Adventure Zones', path: '/#zones' },
    { name: 'Parents Corner', path: '/#parents' },
  ];

  // Smooth scroll handler for hash links
  const handleHashClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (path.startsWith('/#')) {
      e.preventDefault();
      const targetId = path.substring(2);
      const element = document.getElementById(targetId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  return (
    <nav className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${isScrolled ? 'py-2' : 'py-4'}`}>
      <div className={`max-w-7xl mx-auto transition-all duration-300 px-4 md:px-6 lg:px-8`}>
        <div className={`
          ${isScrolled
            ? 'bg-white/95 backdrop-blur-lg shadow-floating border border-white/60'
            : 'bg-white/70 backdrop-blur-md shadow-lg border border-white/40'
          }
          rounded-full px-6 md:px-8 lg:px-10 py-3 md:py-4 transition-all duration-300
        `}>
          <div className="flex justify-between items-center">

            {/* Logo - Left side */}
            <Link href="/" className="flex items-center gap-2 md:gap-3 cursor-pointer group flex-shrink-0">
              <div className="relative">
                <Image
                  src="/logo1.png"
                  alt="ChessPaa"
                  width={80}
                  height={80}
                  quality={100}
                  priority
                  className="w-16 h-16 md:w-20 md:h-20 rounded-full object-cover shadow-md transform group-hover:rotate-12 transition-transform"
                  style={{ imageRendering: 'crisp-edges' }}
                />
              </div>
              <span className="font-bold text-xl md:text-2xl lg:text-3xl text-chess-text">
                ChessPaa
              </span>
            </Link>

            <div className="hidden lg:flex items-center gap-3 xl:gap-4 flex-1 justify-end">
              <div className="flex items-center gap-2 xl:gap-3">
                {navLinks.map((link) => (
                  link.path.startsWith('/#') ? (
                    <a
                      key={link.name}
                      href={link.path}
                      onClick={(e) => handleHashClick(e, link.path)}
                      className="font-semibold text-base xl:text-lg text-chess-text/90 whitespace-nowrap tracking-tight px-4 py-2 rounded-full transition-all duration-200 hover:bg-chess-teal hover:text-white hover:shadow-md hover:-translate-y-0.5"
                    >
                      {link.name}
                    </a>
                  ) : (
                    <Link
                      key={link.name}
                      href={link.path}
                      className="font-semibold text-base xl:text-lg text-chess-text/90 whitespace-nowrap tracking-tight px-4 py-2 rounded-full transition-all duration-200 hover:bg-chess-teal hover:text-white hover:shadow-md hover:-translate-y-0.5"
                    >
                      {link.name}
                    </Link>
                  )
                ))}
              </div>

              <div className="flex items-center gap-4 ml-4">
                <Button size="sm" variant="primary" className="bg-chess-red shadow-chess-red/20 hover:shadow-chess-red/40">
                  Play Now
                </Button>

                {/* Profile Avatar */}
                <div className="relative">
                  <button
                    onClick={() => setIsProfileOpen(!isProfileOpen)}
                    className="w-10 h-10 rounded-full bg-chess-yellow text-chess-text font-bold border-2 border-white shadow-sm hover:scale-105 transition-transform flex items-center justify-center"
                  >
                    {USER_PROFILE.avatarInitials}
                  </button>

                  {/* Profile Dropdown */}
                  {isProfileOpen && (
                    <div className="absolute top-full right-0 mt-4 w-56 bg-white rounded-2xl shadow-card border border-chess-sand p-2 animate-in fade-in slide-in-from-top-2">
                      <div className="px-4 py-3 border-b border-chess-sand/30 mb-2">
                        <p className="font-bold text-chess-text">{USER_PROFILE.name}</p>
                        <p className="text-xs text-chess-text/60">{USER_PROFILE.username}</p>
                      </div>
                      <Link href="/profile" className="flex items-center gap-3 px-4 py-2 rounded-xl hover:bg-chess-sky text-chess-text font-semibold text-sm transition-colors">
                        <User size={16} /> View Profile
                      </Link>
                      <Link href="/profile" className="flex items-center gap-3 px-4 py-2 rounded-xl hover:bg-chess-sky text-chess-text font-semibold text-sm transition-colors">
                        <Gamepad2 size={16} /> My Games
                      </Link>
                      <div className="h-px bg-chess-sand/30 my-1"></div>
                      <button className="w-full flex items-center gap-3 px-4 py-2 rounded-xl hover:bg-red-50 text-chess-red font-semibold text-sm transition-colors text-left">
                        <LogOut size={16} /> Logout
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Mobile Menu Button */}
            <div className="lg:hidden flex items-center gap-3">
              <Link href="/profile" className="w-8 h-8 rounded-full bg-chess-yellow text-chess-text font-bold flex items-center justify-center text-xs">
                {USER_PROFILE.avatarInitials}
              </Link>
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="text-chess-text"
              >
                {isMobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden absolute top-full left-4 right-4 mt-2 bg-white/95 backdrop-blur-lg rounded-3xl shadow-card border border-white/60 p-4 flex flex-col gap-2 animate-in slide-in-from-top-4">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.path}
              onClick={(e) => handleHashClick(e, link.path)}
              className="block px-4 py-3 rounded-xl font-semibold text-base text-chess-text hover:bg-chess-sky"
            >
              {link.name}
            </a>
          ))}
          <div className="h-px bg-chess-sand my-2"></div>
          <Link href="/profile" className="block px-4 py-3 rounded-xl font-semibold text-base text-chess-text hover:bg-chess-sky">
            My Profile
          </Link>
          <Button className="w-full bg-chess-red">Play Now</Button>
        </div>
      )}
    </nav>
  );
};

export default Navbar;