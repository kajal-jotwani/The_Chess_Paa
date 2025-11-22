'use client';

import React from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';

const Footer: React.FC = () => {
  return (
    <footer
      className="
        mt-16
        rounded-t-[3rem]
        pt-12
        pb-6
        bg-linear-to-t from-chess-white via-chess-sky to-chess-blue/50
        border-t border-chess-blue
        shadow-[0_-10px_30px_rgba(15,23,42,0.06)]
        text-chess-text
      "
    >
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
        <div className="col-span-1 md:col-span-2">
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-3">
            ChessPaa
          </h2>
          <p className="font-body text-sm md:text-base text-chess-text/70 max-w-xs">
            Making chess magical, one pawn at a time. Join the adventure today!
          </p>
        </div>

        <div>
          <h4 className="font-display text-md font-bold text-black/80 mb-3 uppercase tracking-[0.18em]">
            Park Map
          </h4>
          <ul className="space-y-2 text-md text-chess-text/80">
            <li>
              <Link
                href="/"
                className="hover:text-chess-teal transition-colors"
              >
                Home
              </Link>
            </li>
            <li>
              <Link
                href="#pieces"
                scroll={false}
                className="hover:text-chess-teal transition-colors"
              >
                Pieces Tour
              </Link>
            </li>
            <li>
              <Link
                href="#zones"
                scroll={false}
                className="hover:text-chess-teal transition-colors"
              >
                Adventure Zones
              </Link>
            </li>
            <li>
              <Link
                href="#parents"
                scroll={false}
                className="hover:text-chess-teal transition-colors"
              >
                Parents Corner
              </Link>
            </li>
          </ul>
        </div>

        {/* Help */}
        <div>
          <h4 className="font-display text-md font-bold text-black/80 mb-3 uppercase tracking-[0.18em]">
            Help
          </h4>
          <ul className="space-y-2 text-md text-chess-text/80">
            <li>
              <Link
                href="#"
                className="hover:text-chess-teal transition-colors"
              >
                Support
              </Link>
            </li>
            <li>
              <Link
                href="#"
                className="hover:text-chess-teal transition-colors"
              >
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link
                href="#"
                className="hover:text-chess-teal transition-colors"
              >
                Terms of Service
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-10 pt-4 border-t border-black/20">
        <div className="flex flex-wrap items-center justify-center gap-2 text-center font-body text-md md:text-md text-black/80">
          <span>Made with ♟️ and</span>
          <Heart size={14} className="text-chess-red" />
          <span>
            by{' '}
            <a
              href="https://github.com/kajal-jotwani"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-chess-teal hover:text-chess-blue "
            >
              Kajal Jotwani
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
