// src/components/ChessBoard.js - Fallback to Unicode with image test
import React from 'react';

// Test with just one image first
const testImageUrl = '/pieces/white-king.png';

// Fallback to better Unicode symbols
const pieceSymbols = {
  // White pieces (outline style)
  'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
  // Black pieces (solid style for better contrast)
  'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
};

function ChessPiece({ piece }) {
  if (!piece) return null;
  
  // Test: Only try to load white king as image, rest as Unicode
  if (piece === 'K') {
    return (
      <img 
        src={testImageUrl}
        alt="White King"
        style={{
          width: '85%',
          height: '85%',
          objectFit: 'contain',
          userSelect: 'none',
          pointerEvents: 'none'
        }}
        onError={(e) => {
          console.error('Image failed to load, falling back to Unicode');
          // Replace with Unicode on error
          e.target.style.display = 'none';
          e.target.parentNode.innerHTML = '<span class="chess-piece white-piece">♔</span>';
        }}
        onLoad={() => {
          console.log('✅ White king image loaded successfully!');
        }}
      />
    );
  }
  
  // All other pieces use Unicode
  const isWhitePiece = piece === piece.toUpperCase();
  
  return (
    <span className={`chess-piece ${isWhitePiece ? 'white-piece' : 'black-piece'}`}>
      {pieceSymbols[piece]}
    </span>
  );
}

export default function ChessBoard({ board, selectedSquare, onSquarePress }) {
  // Add a test component to check if images work at all
  React.useEffect(() => {
    console.log('🧪 Testing image loading...');
    const testImg = new Image();
    testImg.onload = () => console.log('✅ Test image loaded successfully');
    testImg.onerror = () => console.error('❌ Test image failed to load');
    testImg.src = testImageUrl;
  }, []);

  return (
    <div className="chess-board">
      {/* Add a visible test image at the top */}
      <div style={{
        position: 'absolute',
        top: '-50px',
        left: '0',
        background: 'white',
        padding: '5px',
        borderRadius: '4px',
        fontSize: '12px',
        color: 'black'
      }}>
        Test Image: 
        <img 
          src={testImageUrl} 
          alt="test" 
          style={{width: '20px', height: '20px', marginLeft: '5px'}}
          onLoad={() => console.log('✅ Visible test image loaded')}
          onError={() => console.log('❌ Visible test image failed')}
        />
      </div>
      
      {board.map((row, rowIndex) =>
        row.map((piece, colIndex) => {
          const isLight = (rowIndex + colIndex) % 2 === 0;
          const isSelected = selectedSquare && 
            selectedSquare[0] === rowIndex && 
            selectedSquare[1] === colIndex;
          
          return (
            <button
              key={`${rowIndex}-${colIndex}`}
              className={`
                chess-square 
                ${isLight ? 'light-square' : 'dark-square'}
                ${isSelected ? 'selected-square' : ''}
              `}
              onClick={() => onSquarePress(rowIndex, colIndex)}
            >
              <ChessPiece piece={piece} />
            </button>
          );
        })
      )}
    </div>
  );
}