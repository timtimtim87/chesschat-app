// src/components/ChessBoard.js - Final version with all image pieces
import React from 'react';

// Chess piece image mapping
const pieceImages = {
  // White pieces
  'K': '/pieces/white-king.png',
  'Q': '/pieces/white-queen.png',
  'R': '/pieces/white-rook.png',
  'B': '/pieces/white-bishop.png',
  'N': '/pieces/white-knight.png',
  'P': '/pieces/white-pawn.png',
  // Black pieces
  'k': '/pieces/black-king.png',
  'q': '/pieces/black-queen.png',
  'r': '/pieces/black-rook.png',
  'b': '/pieces/black-bishop.png',
  'n': '/pieces/black-knight.png',
  'p': '/pieces/black-pawn.png'
};

// Fallback Unicode symbols (in case images fail to load)
const pieceSymbols = {
  'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
  'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
};

function ChessPiece({ piece }) {
  if (!piece) return null;
  
  const pieceImage = pieceImages[piece];
  if (!pieceImage) return null;
  
  const isWhitePiece = piece === piece.toUpperCase();
  
  return (
    <img 
      src={pieceImage}
      alt={`Chess piece ${piece}`}
      className="chess-piece-image"
      style={{
        width: '85%',
        height: '85%',
        objectFit: 'contain',
        userSelect: 'none',
        pointerEvents: 'none',
        transition: 'all 0.15s ease'
      }}
      onError={(e) => {
        console.warn(`Failed to load chess piece image: ${pieceImage}, falling back to Unicode`);
        // Fallback to Unicode if image fails to load
        e.target.style.display = 'none';
        const unicodeSpan = document.createElement('span');
        unicodeSpan.className = `chess-piece ${isWhitePiece ? 'white-piece' : 'black-piece'}`;
        unicodeSpan.textContent = pieceSymbols[piece];
        e.target.parentNode.appendChild(unicodeSpan);
      }}
      onLoad={() => {
        // Optional: Log successful image loads for debugging
        // console.log(`✅ Loaded ${piece} image`);
      }}
    />
  );
}

export default function ChessBoard({ board, selectedSquare, onSquarePress }) {
  return (
    <div className="chess-board">
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