import React from 'react';

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ width = 40, height = 40, className }) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#1890ff', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#722ed1', stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      
      <g transform="translate(256, 256)">
        <circle cx="0" cy="0" r="200" fill="none" stroke="url(#logoGradient)" strokeWidth="16" />
        
        <path
          d="M -70 -110 
             L 70 -110 
             C 120 -110, 140 -90, 140 -40
             L 140 40
             C 140 90, 120 110, 70 110
             L -70 110
             L -70 -110 Z"
          fill="url(#logoGradient)"
        />
        
        <circle cx="50" cy="0" r="40" fill="white" opacity="0.9" />
        
        <line x1="-30" y1="-50" x2="30" y2="-50" stroke="white" strokeWidth="6" strokeLinecap="round" />
        <line x1="-30" y1="0" x2="10" y2="0" stroke="white" strokeWidth="6" strokeLinecap="round" />
        <line x1="-30" y1="50" x2="30" y2="50" stroke="white" strokeWidth="6" strokeLinecap="round" />
      </g>
    </svg>
  );
};

export default Logo;
