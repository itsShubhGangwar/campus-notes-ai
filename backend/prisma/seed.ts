import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Create Default Admin User
  const adminEmail = 'admin@campusnotes.ai';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Admin@123456', salt);

    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: 'System Administrator',
        role: Role.ADMIN,
        bio: 'CampusNotes Platform Administrator',
      },
    });
    console.log('✅ Created default admin user: admin@campusnotes.ai (Pass: Admin@123456)');
  }

  // 2. Seed Colleges
  const collegesData = [
    { name: 'MIT (Massachusetts Institute of Technology)', code: 'MIT', city: 'Cambridge', state: 'MA' },
    { name: 'Stanford University', code: 'STANFORD', city: 'Stanford', state: 'CA' },
    { name: 'IIT Delhi (Indian Institute of Technology)', code: 'IITD', city: 'New Delhi', state: 'Delhi' },
    { name: 'UC Berkeley', code: 'UCB', city: 'Berkeley', state: 'CA' },
  ];

  for (const cData of collegesData) {
    const college = await prisma.college.upsert({
      where: { name: cData.name },
      update: {},
      create: cData,
    });

    // 3. Seed Branches for each College
    const branchesData = [
      { name: 'Computer Science & Engineering', code: 'CSE' },
      { name: 'Electrical & Electronics Engineering', code: 'EEE' },
      { name: 'Mechanical Engineering', code: 'MECH' },
    ];

    for (const bData of branchesData) {
      const branch = await prisma.branch.upsert({
        where: {
          collegeId_code: {
            collegeId: college.id,
            code: bData.code,
          },
        },
        update: {},
        create: {
          name: bData.name,
          code: bData.code,
          collegeId: college.id,
        },
      });

      // 4. Seed Core Subjects for CSE
      if (bData.code === 'CSE') {
        const subjectsData = [
          { name: 'Introduction to Programming', code: 'CS101', semester: 1, description: 'C/C++ basics, control structures, and memory' },
          { name: 'Data Structures and Algorithms', code: 'CS201', semester: 2, description: 'Arrays, linked lists, trees, graphs, and Big-O' },
          { name: 'Object-Oriented Programming', code: 'CS202', semester: 2, description: 'OOP concepts, Java/C++, polymorphism, and design patterns' },
          { name: 'Computer Organization & Architecture', code: 'CS301', semester: 3, description: 'CPU registers, memory hierarchy, and pipelining' },
          { name: 'Database Management Systems', code: 'CS302', semester: 3, description: 'Relational model, SQL, normalization, and ACID properties' },
          { name: 'Operating Systems', code: 'CS401', semester: 4, description: 'Processes, threads, CPU scheduling, and virtual memory' },
          { name: 'Computer Networks', code: 'CS402', semester: 4, description: 'TCP/IP, OSI model, routing algorithms, and socket programming' },
          { name: 'Theory of Computation', code: 'CS501', semester: 5, description: 'Automata, grammars, Turing machines, and decidability' },
          { name: 'Artificial Intelligence & Machine Learning', code: 'CS502', semester: 5, description: 'Search, neural networks, supervised learning' },
          { name: 'Compiler Design', code: 'CS601', semester: 6, description: 'Lexical analysis, parsing, ASTs, and code optimization' },
        ];

        for (const sData of subjectsData) {
          await prisma.subject.upsert({
            where: {
              branchId_code_semester: {
                branchId: branch.id,
                code: sData.code,
                semester: sData.semester,
              },
            },
            update: {},
            create: {
              ...sData,
              branchId: branch.id,
            },
          });
        }
      }
    }
  }

  console.log('✅ Academic hierarchy seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
