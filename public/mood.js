'use strict';
(()=>{
    const MOVIES = {
      action: [
        { title: "Mad Max: Fury Road", year: "2015", rating: "8.1/10", tags: ["Action", "Post-Apocalyptic", "Thrilling"] },
        { title: "Top Gun: Maverick", year: "2022", rating: "8.3/10", tags: ["Action", "Drama", "Aviation"] },
        { title: "John Wick", year: "2014", rating: "7.4/10", tags: ["Action", "Crime", "Stylish"] },
        { title: "The Dark Knight", year: "2008", rating: "9.0/10", tags: ["Action", "Crime", "Epic"] },
        { title: "Mission: Impossible – Fallout", year: "2018", rating: "7.7/10", tags: ["Action", "Thriller", "Stunts"] },
      ],
      comedy: [
        { title: "The Grand Budapest Hotel", year: "2014", rating: "8.1/10", tags: ["Comedy", "Drama", "Quirky"] },
        { title: "Superbad", year: "2007", rating: "7.6/10", tags: ["Comedy", "Coming-of-age", "Hilarious"] },
        { title: "Game Night", year: "2018", rating: "7.0/10", tags: ["Comedy", "Mystery", "Fun"] },
        { title: "The Nice Guys", year: "2016", rating: "7.4/10", tags: ["Comedy", "Crime", "Buddy Cop"] },
        { title: "Knives Out", year: "2019", rating: "7.9/10", tags: ["Comedy", "Mystery", "Clever"] },
      ],
      romance: [
        { title: "La La Land", year: "2016", rating: "8.0/10", tags: ["Romance", "Musical", "Beautiful"] },
        { title: "About Time", year: "2013", rating: "7.8/10", tags: ["Romance", "Drama", "Heartfelt"] },
        { title: "Before Sunrise", year: "1995", rating: "8.1/10", tags: ["Romance", "Drama", "Classic"] },
        { title: "The Notebook", year: "2004", rating: "7.8/10", tags: ["Romance", "Drama", "Emotional"] },
        { title: "Crazy, Stupid, Love", year: "2011", rating: "7.4/10", tags: ["Romance", "Comedy", "Charming"] },
      ],
      scifi: [
        { title: "Interstellar", year: "2014", rating: "8.7/10", tags: ["Sci-Fi", "Epic", "Mind-blowing"] },
        { title: "Arrival", year: "2016", rating: "7.9/10", tags: ["Sci-Fi", "Drama", "Thoughtful"] },
        { title: "Dune", year: "2021", rating: "8.0/10", tags: ["Sci-Fi", "Epic", "Visually stunning"] },
        { title: "Ex Machina", year: "2014", rating: "7.7/10", tags: ["Sci-Fi", "Thriller", "AI"] },
        { title: "Everything Everywhere All at Once", year: "2022", rating: "8.0/10", tags: ["Sci-Fi", "Comedy", "Multiverse"] },
      ],
      horror: [
        { title: "Hereditary", year: "2018", rating: "7.3/10", tags: ["Horror", "Psychological", "Disturbing"] },
        { title: "A Quiet Place", year: "2018", rating: "7.5/10", tags: ["Horror", "Thriller", "Tense"] },
        { title: "Get Out", year: "2017", rating: "7.7/10", tags: ["Horror", "Thriller", "Social commentary"] },
        { title: "The Conjuring", year: "2013", rating: "7.5/10", tags: ["Horror", "Supernatural", "Scary"] },
        { title: "Midsommar", year: "2019", rating: "7.1/10", tags: ["Horror", "Folk horror", "Unique"] },
      ],
      animated: [
        { title: "Spider-Man: Into the Spider-Verse", year: "2018", rating: "8.4/10", tags: ["Animation", "Action", "Visually incredible"] },
        { title: "Spirited Away", year: "2001", rating: "8.6/10", tags: ["Animation", "Fantasy", "Masterpiece"] },
        { title: "The Lion King", year: "1994", rating: "8.5/10", tags: ["Animation", "Drama", "Classic"] },
        { title: "Coco", year: "2017", rating: "8.4/10", tags: ["Animation", "Family", "Emotional"] },
        { title: "Ratatouille", year: "2007", rating: "8.1/10", tags: ["Animation", "Comedy", "Heartwarming"] },
      ],
      thriller: [
        { title: "Gone Girl", year: "2014", rating: "8.1/10", tags: ["Thriller", "Mystery", "Gripping"] },
        { title: "Parasite", year: "2019", rating: "8.5/10", tags: ["Thriller", "Drama", "Oscar winner"] },
        { title: "Shutter Island", year: "2010", rating: "8.1/10", tags: ["Thriller", "Mystery", "Twist ending"] },
        { title: "Prisoners", year: "2013", rating: "8.1/10", tags: ["Thriller", "Drama", "Intense"] },
        { title: "Se7en", year: "1995", rating: "8.6/10", tags: ["Thriller", "Crime", "Dark"] },
      ],
    };

    const MUSIC = {
      happy: {
        label: "😄 Feeling Happy",
        playlists: [
          { name: "Pharrell Williams — Happy", meta: "The ultimate feel-good anthem you can't resist" },
          { name: "Bruno Mars — Uptown Funk", meta: "Funky grooves for an instant mood lift" },
          { name: "Lizzo — Juice", meta: "High-energy confidence booster" },
          { name: "Katy Perry — Roar", meta: "Empowering pop perfection" },
          { name: "Dua Lipa — Levitating", meta: "Danceable synth-pop banger" },
        ]
      },
      sad: {
        label: "😢 Feeling Blue",
        playlists: [
          { name: "Lewis Capaldi — Someone You Loved", meta: "Let the tears flow — it's cathartic" },
          { name: "Adele — Someone Like You", meta: "Heartbreak never sounded so beautiful" },
          { name: "Billie Eilish — when the party's over", meta: "Quiet, emotional, and raw" },
          { name: "Bon Iver — Skinny Love", meta: "Delicate folk for the wounded soul" },
          { name: "The Fray — How to Save a Life", meta: "Deeply moving piano-driven ballad" },
        ]
      },
      chill: {
        label: "😎 Chill Vibes",
        playlists: [
          { name: "Tame Impala — The Less I Know the Better", meta: "Dreamy psychedelic pop" },
          { name: "Mac DeMarco — Chamber of Reflection", meta: "Slow, smooth lo-fi gold" },
          { name: "Norah Jones — Don't Know Why", meta: "Warm jazz vocals to unwind" },
          { name: "Lofi Hip Hop Radio Playlist", meta: "beats to relax/study to — the classic" },
          { name: "Khruangbin — Lady & Man", meta: "Laid-back grooves from around the world" },
        ]
      },
      energetic: {
        label: "⚡ High Energy",
        playlists: [
          { name: "The Weeknd — Blinding Lights", meta: "Unstoppable 80s-inspired synth drive" },
          { name: "Eminem — Lose Yourself", meta: "Legendary motivation anthem" },
          { name: "Daft Punk — Harder Better Faster Stronger", meta: "Electronic perfection for peak performance" },
          { name: "AC/DC — Thunderstruck", meta: "Classic rock that wakes the dead" },
          { name: "Kendrick Lamar — HUMBLE.", meta: "Confidence and heat in one track" },
        ]
      },
      romantic: {
        label: "💕 Romantic Mood",
        playlists: [
          { name: "Ed Sheeran — Perfect", meta: "The most romantic song of the decade" },
          { name: "John Legend — All of Me", meta: "Soulful piano ballad for love" },
          { name: "Beyoncé — Crazy in Love", meta: "Sultry and soulful" },
          { name: "Frank Sinatra — Fly Me to the Moon", meta: "Timeless classic romance" },
          { name: "Harry Styles — Watermelon Sugar", meta: "Sweet and summery feel-good pop" },
        ]
      },
      focus: {
        label: "🎯 Deep Focus",
        playlists: [
          { name: "Hans Zimmer — Inception OST", meta: "Epic orchestral concentration fuel" },
          { name: "Brian Eno — Music for Airports", meta: "Ambient soundscape to quiet the mind" },
          { name: "Explosions in the Sky — Your Hand in Mine", meta: "Instrumental post-rock perfection" },
          { name: "Lo-Fi Study Beats Playlist", meta: "Classic lo-fi beats for work/study" },
          { name: "Max Richter — On the Nature of Daylight", meta: "Hauntingly beautiful classical" },
        ]
      },
    };

    const FOOD = {
      hungry: [
        { name: "🍕 Pepperoni Pizza", meta: "Ultimate comfort food — order or make it!" },
        { name: "🍜 Ramen Noodles", meta: "Warming, filling, deeply satisfying" },
        { name: "🍔 Classic Cheeseburger", meta: "Can't go wrong with the classic" },
        { name: "🍗 Butter Chicken + Naan", meta: "Rich and aromatic — restaurant quality at home" },
        { name: "🥗 Loaded Burrito Bowl", meta: "Fresh, healthy, and super filling" },
      ],
      snack: [
        { name: "🍿 Popcorn + streaming show", meta: "The perfect lazy evening snack" },
        { name: "🥜 Peanut Butter Toast", meta: "Quick, filling, and protein-packed" },
        { name: "🍫 Dark Chocolate", meta: "For a guilt-free sweet fix" },
        { name: "🧀 Cheese & Crackers", meta: "Classy Mediterranean-style snacking" },
        { name: "🥤 Smoothie Bowl", meta: "Healthy, photogenic, and delicious" },
      ],
      dessert: [
        { name: "🍦 Ice Cream Sundae", meta: "Stack it with all your favorite toppings" },
        { name: "🎂 Chocolate Lava Cake", meta: "Gooey molten center — heaven in a ramekin" },
        { name: "🍪 Fresh Baked Cookies", meta: "Warm out of the oven — nothing better" },
        { name: "🍮 Crème Brûlée", meta: "Fancy yet deceptively simple to make" },
        { name: "🍓 Strawberry Cheesecake", meta: "Creamy, fruity, and absolutely divine" },
      ],
    };

    const ACTIVITIES = [
      { name: "🎮 Play a Video Game", meta: "Jump into an open world or challenge a friend online", tags: ["Indoor", "Fun", "Gaming"] },
      { name: "🎨 Doodle or Sketch", meta: "Even if you're not artistic — it's therapeutic", tags: ["Creative", "Relaxing", "Indoor"] },
      { name: "🕺 Try a 15-min Dance Session", meta: "Put on your fav playlist and go wild in your room", tags: ["Fun", "Active", "Indoor"] },
      { name: "📖 Start a New Book", meta: "Pick a genre you've never tried before", tags: ["Relaxing", "Educational", "Indoor"] },
      { name: "🌳 Take a Walk Outside", meta: "Even 20 mins of fresh air clears the head", tags: ["Outdoor", "Healthy", "Active"] },
      { name: "🧩 Solve a Puzzle", meta: "Jigsaw or logic puzzles for a satisfying mental workout", tags: ["Indoor", "Brain", "Relaxing"] },
      { name: "🍳 Try a New Recipe", meta: "Open YouTube, pick something you've never cooked before", tags: ["Creative", "Fun", "Productive"] },
      { name: "🎬 Watch a Documentary", meta: "Expand your mind — tons of great ones on Netflix/YouTube", tags: ["Educational", "Indoor", "Chill"] },
      { name: "🧘 Meditate for 10 Minutes", meta: "Use Headspace or just YouTube guided meditation", tags: ["Wellness", "Calm", "Healthy"] },
      { name: "🎸 Learn a New Instrument Tune", meta: "Look up a tutorial for a song you love", tags: ["Creative", "Productive", "Music"] },
    ];


window.vibeCatalog = { MOVIES, MUSIC, FOOD, ACTIVITIES };
})();
