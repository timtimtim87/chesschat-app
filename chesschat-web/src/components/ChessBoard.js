// src/components/ChessBoard.js - Web version
import React from 'react';

// Chess piece symbols
const pieceSymbols = {
  // White pieces (outline style)
  'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
  // Black pieces (same shapes, colored black)  
  'k': '♔', 'q': '♕', 'r': '♖', 'b': '♗', 'n': '♘', 'p': '♙'
};

function ChessPiece({ piece }) {
  if (!piece) return null;
  
  const isWhitePiece = piece === piece.toUpperCase();
  
  return (
    <span className={`chess-piece ${isWhitePiece ? 'white-piece' : 'black-piece'}`}>
      {pieceSymbols[piece]}
    </span>
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
