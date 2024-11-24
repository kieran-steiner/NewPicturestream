// Import benötigter Module
const express = require("express");
const { engine } = require("express-handlebars");
const session = require("express-session");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const path = require("path");
const { check, validationResult } = require("express-validator");

// App-Konfiguration
const app = express();
const db = new sqlite3.Database("./database.sqlite");
const upload = multer({ dest: "public/uploads/" });

app.use(bodyParser.urlencoded({ extended: true })); // Für POST-Anfragen
app.use(express.static(path.join(__dirname, "public"))); // Statische Dateien
app.use(
  session({
    secret: "your_secret_key", // Sicherheits-Schlüssel
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 30 * 60 * 1000 }, // Session-Timeout: 30 Minuten
  })
);

// Handlebars als Template-Engine einrichten
app.engine("hbs", engine({ defaultLayout: "main", extname: ".hbs" }));
app.set("view engine", "hbs");

// Datenbank-Setup: Tabellen erstellen, falls nicht vorhanden
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS pictures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT,
    title TEXT NOT NULL,
    description TEXT,
    user_id INTEGER,
    time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS users_pictures_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    picture_id INTEGER,
    is_favorite BOOLEAN DEFAULT 0
  )`);
});

// Middleware: Authentifizierung prüfen
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next(); // Benutzer ist authentifiziert
  } else {
    res.redirect("/login"); // Nicht authentifiziert: Weiterleitung zur Login-Seite
  }
};

// Routen

// Startseite: Weiterleitung zur Login-Seite
app.get("/", (req, res) => res.redirect("/login"));

// Login-Seite
app.get(
  "/login",
  (req, res) => res.render("login", { error: req.query.error }) // Zeigt Fehlermeldungen an
);

// Login-Logik
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  // Benutzer in der Datenbank suchen
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (err || !user) {
      return res.render("login", { error: "Benutzername nicht gefunden." });
    }

    // Passwort validieren
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.render("login", { error: "Ungültige Anmeldedaten." });
    }

    // Benutzer erfolgreich authentifiziert
    req.session.user = { id: user.id, username: user.username };
    res.redirect("/picturestream");
  });
});

// Registrierungsseite
app.get("/register", (req, res) =>
  res.render("register", { error: req.query.error })
);

// Registrierung-Logik
app.post(
  "/register",
  [
    // Validierungsregeln
    check("username")
      .isAlphanumeric()
      .withMessage("Der Benutzername darf nur Buchstaben und Zahlen enthalten.")
      .isLength({ min: 3 })
      .withMessage("Der Benutzername muss mindestens 3 Zeichen lang sein."),
    check("email")
      .isEmail()
      .withMessage("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
    check("password")
      .isLength({ min: 6 })
      .withMessage("Das Passwort muss mindestens 6 Zeichen lang sein."),
  ],
  (req, res) => {
    const errors = validationResult(req);

    // Validierungsfehler anzeigen
    if (!errors.isEmpty()) {
      return res.render("register", { error: errors.array()[0].msg });
    }

    const { username, email, password } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Benutzer registrieren
    db.run(
      "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
      [username, email, hashedPassword],
      (err) => {
        if (err) {
          const errorMessage = err.message.includes("UNIQUE constraint failed")
            ? "Benutzername oder E-Mail bereits registriert."
            : "Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.";
          return res.render("register", { error: errorMessage });
        }
        res.redirect("/login");
      }
    );
  }
);

// Picturestream-Seite
app.get("/picturestream", isAuthenticated, (req, res) => {
  db.all(
    `SELECT pictures.*, users.username 
     FROM pictures 
     JOIN users ON pictures.user_id = users.id 
     ORDER BY time DESC`,
    [],
    (err, pictures) => {
      if (err) {
        return res.render("picturestream", {
          error: "Fehler beim Laden der Bilder.",
        });
      }
      res.render("picturestream", { pictures, user: req.session.user });
    }
  );
});

// My Picturestream-Seite
app.get("/mypicturestream", isAuthenticated, (req, res) => {
  db.all(
    `SELECT pictures.*, users.username 
     FROM pictures 
     JOIN users ON pictures.user_id = users.id 
     JOIN users_pictures_favorites ON pictures.id = users_pictures_favorites.picture_id 
     WHERE users_pictures_favorites.user_id = ? AND users_pictures_favorites.is_favorite = 1 
     ORDER BY time DESC`,
    [req.session.user.id],
    (err, pictures) => {
      if (err) {
        return res.render("mypicturestream", {
          error: "Fehler beim Laden der Favoriten.",
        });
      }
      res.render("mypicturestream", { pictures, user: req.session.user });
    }
  );
});

// Upload-Seite
app.get("/upload", isAuthenticated, (req, res) => res.render("upload"));

// Bild hochladen
app.post("/upload", isAuthenticated, upload.single("picture"), (req, res) => {
  const { title, description } = req.body;

  db.run(
    "INSERT INTO pictures (file_name, title, description, user_id) VALUES (?, ?, ?, ?)",
    [req.file.filename, title, description, req.session.user.id],
    () => {
      res.redirect("/picturestream");
    }
  );
});

// Favoriten hinzufügen
app.post("/favorite/:id", isAuthenticated, (req, res) => {
  const pictureId = req.params.id;

  db.run(
    "INSERT INTO users_pictures_favorites (user_id, picture_id, is_favorite) VALUES (?, ?, 1)",
    [req.session.user.id, pictureId],
    () => {
      res.redirect("/picturestream");
    }
  );
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server läuft auf http://localhost:${PORT}`)
);
