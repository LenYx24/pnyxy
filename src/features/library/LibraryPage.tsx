import { BookCard } from "./BookCard";

const mockBooks = [
  { title: "Clean Code", author: "Robert C. Martin", progress: 72 },
  { title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", progress: 35 },
  { title: "The Pragmatic Programmer", author: "Hunt & Thomas", progress: 100 },
  { title: "Structure and Interpretation of Computer Programs", author: "Abelson & Sussman", progress: 12 },
  { title: "Gödel, Escher, Bach", author: "Douglas Hofstadter", progress: 45 },
  { title: "Thinking, Fast and Slow", author: "Daniel Kahneman", progress: 0 },
];

export function LibraryPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-text-primary">Your Library</h2>
        <p className="text-sm text-text-secondary">
          {mockBooks.length} books in your collection
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {mockBooks.map((book) => (
          <BookCard key={book.title} {...book} />
        ))}
      </div>
    </div>
  );
}
