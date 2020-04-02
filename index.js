require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");

const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

const wait_for_frame = (page, frame_name) => {
  let fulfill_promise;
  const promise = new Promise(x => (fulfill_promise = x));

  const check_frame = () => {
    const frame = page
      .frames()
      .find(current_frame => current_frame.name() === frame_name);

    if (frame) {
      fulfill_promise(frame);
    } else {
      page.once("frameattached", check_frame);
    }
  };
  check_frame();
  return promise;
};

(async () => {
  const browser = await puppeteer.launch({
    headless: true
  });
  const page = await browser.newPage();
  let courseData, courseFrame;

  console.log("Loading login page.");
  try {
    await page.goto("https://blackboard.unist.ac.kr/");
  } catch (err) {
    console.error("Error loading page.", err);
    return await browser.close();
  }

  console.log("Accepting cookies.");
  try {
    await page.waitForSelector("#agree_button", { timeout: 5000 });
    await page.click("#agree_button");
  } catch (error) {
    console.log("Agree to cookies element didn't appear.");
  }

  console.log("Entering username and password.");
  try {
    await page.click("#user_id");
    await page.keyboard.type(USERNAME);
    await page.click("#password");
    await page.keyboard.type(PASSWORD);

    const navPromise = page.waitForNavigation();
    await page.click("#entry-login");
    await navPromise;
  } catch (err) {
    console.error("Error entering username and password.\t", err);
    return await browser.close();
  }

  console.log("Navigating to grades.");
  try {
    const navPromise = page.waitForNavigation({
      waitUntil: "domcontentloaded"
    });
    await page.goto(
      "https://blackboard.unist.ac.kr/webapps/bb-social-learning-BB5a8801a04ee83/execute/mybb?cmd=display&toolId=MyGradesOnMyBb_____MyGradesTool"
    );
    await navPromise;
  } catch (err) {
    console.error("Error navigating to grades.\t", err);
    return await browser.close();
  }

  console.log("Parsing Courses");
  try {
    courseFrame = await wait_for_frame(page, "mybbCanvas");

    await courseFrame.waitForSelector(".stream_item");

    courseData = await courseFrame.evaluate(() => {
      let courses = document.querySelectorAll(".stream_item"),
        courseData = [];

      for (course of courses) {
        let courseName = course.querySelector(".stream_area_name").innerText;

        let gradeValue = course.querySelector(".grade-value").innerText,
          lastUpdated =
            course.querySelector(".stream_datestamp").innerText === ""
              ? "-"
              : course.querySelector(".stream_datestamp").innerText;

        courseData.push({
          courseName,
          gradeValue,
          lastUpdated,
          gradeUrl: course.getAttribute("bb:rhs"),
          items: []
        });
      }

      return Promise.resolve(courseData);
    });
  } catch (err) {
    console.error("Error parsing courses.\t", err);
    return await browser.close();
  }

  console.log("Parsing Grades");
  try {
    const gradeFrame = courseFrame
      .childFrames()
      .find(frame => frame.name() === "right_stream_mygrades");

    for (course of courseData) {
      const navPromise = gradeFrame.waitForNavigation();
      await gradeFrame.goto(
        "https://blackboard.unist.ac.kr/" + course.gradeUrl
      );
      await navPromise;

      await gradeFrame.waitForSelector("#grades_wrapper", { timeout: 10000 });

      console.log(`Parsing grades for "${course.courseName}".`);

      const parsedGrades = await gradeFrame.evaluate(_ => {
        const gradedItems = document.querySelectorAll(
          ".sortable_item_row:not(.calculatedRow)"
        );
        let itemArr = [];

        gradedItems.forEach(grade => {
          const title = grade
            .querySelector(".cell.gradable")
            .innerText.split("\n")[0];

          const due = grade.querySelector(".gradable > .activityType")
            ? grade.querySelector(".gradable > .activityType").innerText
            : "No Due Date";

          const type = grade.querySelector(".itemCat")
            ? grade.querySelector(".itemCat").innerText
            : "No Type";

          const submitted =
            !grade.querySelector(".lastActivityDate") ||
            grade.querySelector(".lastActivityDate").innerText === ""
              ? "Not Submitted"
              : grade.querySelector(".lastActivityDate").innerText;

          const status = grade.querySelector(".timestamp > .activityType")
            ? grade.querySelector(".timestamp > .activityType").innerText
            : "No Status";

          const isBoolean = grade.querySelector(".gradeStatus > span > span");
          const score = isBoolean
            ? isBoolean.innerText
            : grade.querySelector(".grade > .grade").innerText;

          const total = isBoolean
            ? "No Total"
            : grade.querySelector(".pointsPossible")
            ? grade.querySelector(".pointsPossible").innerText.replace("/", "")
            : "No Total";

          itemArr.push({ title, due, type, submitted, status, score, total });
        });

        return Promise.resolve(itemArr);
      }, course);

      course.items = parsedGrades;
      delete course.gradeUrl;
    }
  } catch (err) {
    console.error("Error parsing grades.\t", err);
    return await browser.close();
  }

  try {
    console.log(
      `Complete, ${courseData.length} courses scraped. Closing browser.`
    );
    await browser.close();
  } catch (err) {
    console.error("Error closing browser\t", err);
    return;
  }

  fs.writeFileSync("courses_data.json", JSON.stringify(courseData, null, 4));
})();
