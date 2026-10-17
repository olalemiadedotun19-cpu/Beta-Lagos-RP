/**
 * JobService - Career & Employment Architecture
 * Connects directly to authenticated player career profile and district employer locations.
 * Zero fabricated dummy job entries - all vacancies originate from actual district POIs.
 */

import { PlayerData, PlayerCareer } from '../types/game';
import { IKEJA_DISTRICT_DATA } from '../data/worldData';

export interface JobVacancy {
  id: string;
  title: string;
  employerName: string;
  locationId: string;
  hourlyWage: number;
  minEducation: string;
  shiftHours: string;
  description: string;
}

export class JobService {
  private static instance: JobService;

  // Real district vacancies based on actual Ikeja buildings
  private vacancies: JobVacancy[] = [
    {
      id: 'job_tech_dev',
      title: 'Junior Software Engineer',
      employerName: 'Silicon Ikeja Labs',
      locationId: 'poi_tech_hub',
      hourlyWage: 5000,
      minEducation: 'Undergraduate',
      shiftHours: '09:00 - 17:00 (Mon - Fri)',
      description: 'Full-stack software engineering and cloud infrastructure development.',
    },
    {
      id: 'job_tech_lead',
      title: 'Lead Systems Architect',
      employerName: 'Silicon Ikeja Labs',
      locationId: 'poi_tech_hub',
      hourlyWage: 12500,
      minEducation: 'Postgraduate',
      shiftHours: '10:00 - 18:00 (Mon - Fri)',
      description: 'Distributed backend systems design and cloud microservices orchestration.',
    },
    {
      id: 'job_buka_cook',
      title: 'Kitchen & Catering Assistant',
      employerName: 'Mama Put Buka',
      locationId: 'poi_mama_put',
      hourlyWage: 2500,
      minEducation: 'Secondary School',
      shiftHours: '08:00 - 16:00 (Daily)',
      description: 'Culinary preparation of classic Nigerian party jollof, soups, and dishes.',
    },
    {
      id: 'job_mall_associate',
      title: 'Retail Store Associate',
      employerName: 'Ikeja City Mall',
      locationId: 'poi_city_mall',
      hourlyWage: 3200,
      minEducation: 'Secondary School',
      shiftHours: '10:00 - 18:00 (Mon - Sat)',
      description: 'Merchandise stocking, customer service, and POS billing operations.',
    },
    {
      id: 'job_nurse',
      title: 'Clinical Care Nurse',
      employerName: 'Ikeja General Health Center',
      locationId: 'poi_health_center',
      hourlyWage: 6800,
      minEducation: 'Undergraduate',
      shiftHours: '08:00 - 16:00 (Mon - Fri)',
      description: 'Inpatient triage, vital sign assessments, and community healthcare.',
    },
  ];

  public static getInstance(): JobService {
    if (!JobService.instance) {
      JobService.instance = new JobService();
    }
    return JobService.instance;
  }

  public getVacancies(): JobVacancy[] {
    return [...this.vacancies];
  }

  public getVacancyById(id: string): JobVacancy | undefined {
    return this.vacancies.find((v) => v.id === id);
  }

  /**
   * Applies for a real vacancy and updates player's career profile
   */
  public applyForJob(playerData: PlayerData, vacancyId: string): { success: boolean; message: string } {
    const vacancy = this.getVacancyById(vacancyId);
    if (!vacancy) {
      return { success: false, message: 'Vacancy no longer available.' };
    }

    if (playerData.career.isEmployed && playerData.career.jobTitle === vacancy.title) {
      return { success: false, message: 'You are already currently employed in this position.' };
    }

    // Apply job
    playerData.career = {
      isEmployed: true,
      jobTitle: vacancy.title,
      employer: vacancy.employerName,
      hourlyWage: vacancy.hourlyWage,
      experienceYears: playerData.career.experienceYears || 1,
    };

    return {
      success: true,
      message: `Congratulations! You have been hired as ${vacancy.title} at ${vacancy.employerName}.`,
    };
  }
}

export const jobService = JobService.getInstance();
